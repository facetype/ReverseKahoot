import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '@/pages/auth/useSession';
import {
    getQuizInstance,
    isQuizInstanceMember,
    type QuizInstanceSession,
} from '@/api/supabase/quiz-instance-api';
import {
    sendQuizInstanceEvent,
    subscribeToQuizInstance,
    unsubscribeFromQuizInstance,
    type QuizInstanceEventMessage,
} from '@/api/supabase/realtime-api';
import Navbar from '@/common/components/navbar/navbar';
import '@/common/styles/quiz.css';
import './GamePage.css';

// Important for managing what codepath GamePage exposes based on role in a given QuizInstance.
interface GameRole {
    isHost: boolean;
}

// Planned: quiz metadata (id + currentQuestionNumber) once the host's question
// loop exists and the instance tracks progress.

// Ledger of all player transactions during a quiz. Every payload members send
// through sendQuizInstanceEvent lands here.
interface Transaction {
    playerUUID: string; // player identifier
    type: string; // type of transaction ex. "bet"
    sentAt?: string; // server-verified send time
    payload: unknown; // specific transaction data
}

interface PlayerTransactions {
    // used to cross reference validity, on divergence a player may be asked to reconsider transactions.
    checksum: string;
    transactions: Transaction[];
}

interface GameNavState {
    instance?: QuizInstanceSession;
    quizTitle?: string;
}

// The event name for free-form messages players send while the game runs.
// The server reserves game-created/player-joined/game-started.
const PLAYER_MESSAGE_EVENT = 'player-message';
const LEDGER_LIMIT = 50;

function GamePage() {
    const { instanceId = '' } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const navState = (location.state as GameNavState | null) ?? null;
    const { session, loading: sessionLoading } = useSession();

    const [instance, setInstance] = useState<QuizInstanceSession | null>(navState?.instance ?? null);
    const [quizTitle] = useState<string | null>(navState?.quizTitle ?? null);
    const [loading, setLoading] = useState(!navState?.instance);
    const [error, setError] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);
    const [closed, setClosed] = useState(false);
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    // Every payload received on the game channel, newest first. The checksum
    // stays empty until divergence checking between host and players exists.
    const [ledger, setLedger] = useState<PlayerTransactions>({ checksum: '', transactions: [] });

    const lobbyPath = `/lobby/${instanceId}`;

    // Reconnect after a reload: the navigation state is gone, so read the row.
    // RLS only lets the host and the joined players see the instance, so an
    // unreadable game means "not yours". A game that has not started yet
    // belongs back in the lobby.
    useEffect(() => {
        if (instance || !instanceId) return;
        let cancelled = false;
        getQuizInstance(instanceId)
            .then(row => {
                if (cancelled) return;
                if (!row.isStarted) {
                    navigate(lobbyPath, { replace: true });
                    return;
                }
                setInstance(row);
                setLoading(false);
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : 'Could not load the game.');
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [instance, instanceId, navigate, lobbyPath]);

    // Listen on the game's private channel. Server events update the shared
    // state; everything members send through sendQuizInstanceEvent lands in
    // the transaction ledger.
    useEffect(() => {
        if (!instanceId) return;
        const channel = subscribeToQuizInstance(instanceId, {
            onPlayerJoined: players =>
                setInstance(prev => (prev ? { ...prev, attendingPlayers: players } : prev)),
            onSubscribed: () => {
                setConnected(true);
                setClosed(false);
            },
            onClosed: () => {
                setConnected(false);
                setClosed(true);
            },
            onEvent: (event, body: QuizInstanceEventMessage) => {
                setLedger(prev => ({
                    ...prev,
                    transactions: [
                        {
                            playerUUID: body.from ?? 'unknown',
                            type: event,
                            sentAt: body.sentAt,
                            payload: body.payload,
                        },
                        ...prev.transactions,
                    ].slice(0, LEDGER_LIMIT),
                }));
            },
        });
        return () => unsubscribeFromQuizInstance(channel);
    }, [instanceId]);

    const role: GameRole = {
        isHost: session?.user.id != null && session.user.id === instance?.hostId,
    };

    const isMember = instance != null && (!sessionLoading ? isQuizInstanceMember(instance, session?.user.id) : false);

    const handleSend = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const text = message.trim();
        if (!instance || !text) return;
        setSending(true);
        setError(null);
        try {
            await sendQuizInstanceEvent(instance.instanceId, PLAYER_MESSAGE_EVENT, { text });
            setMessage('');
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Could not send the payload.');
        } finally {
            setSending(false);
        }
    };

    if (loading) {
        return (
            <div>
                <Navbar />
                <div className="quiz-page">
                    <p className="quiz-muted center-text">Connecting to the game…</p>
                </div>
            </div>
        );
    }

    if (!instance) {
        return (
            <div>
                <Navbar />
                <div className="quiz-page">
                    <p className="quiz-error center-text">{error ?? 'Game not found.'}</p>
                    <p className="center-text"><Link className="quiz-link" to="/">Back home</Link></p>
                </div>
            </div>
        );
    }

    // The session is still loading: we cannot tell member from stranger yet.
    if (!isMember && sessionLoading) {
        return (
            <div>
                <Navbar />
                <div className="quiz-page">
                    <p className="quiz-muted center-text">Checking your seat in this game…</p>
                </div>
            </div>
        );
    }

    if (!isMember) {
        return (
            <div>
                <Navbar />
                <div className="quiz-page">
                    <p className="quiz-error center-text">You are not registered in this game.</p>
                    <p className="quiz-muted center-text">Rejoin with the game code on the home page.</p>
                    <p className="center-text"><Link className="quiz-link" to="/">Back home</Link></p>
                </div>
            </div>
        );
    }

    const players = instance.attendingPlayers;
    const me = session?.user.id ?? null;

    return (
        <div className="game-page">
            <Navbar />
            <main className="game-main">
                <h1 className="center-text">{quizTitle ?? 'Game'}</h1>

                <p className="quiz-muted center-text game-status" role="status">
                    {closed
                        ? 'Connection lost — reload the page or rejoin with the game code.'
                        : connected
                            ? 'Connected to the game.'
                            : 'Connecting…'}
                    {role.isHost ? ' You are the host.' : ''}
                </p>

                <section className="game-players" aria-label={`Players (${players.length})`}>
                    <h2 className="center-text">Players ({players.length})</h2>
                    {players.length === 0
                        ? <p className="quiz-muted center-text">No players are registered.</p>
                        : (
                            <ul className="quiz-list">
                                {players.map((id, index) => (
                                    <li key={id} className="quiz-list-item">
                                        <span>
                                            Player {index + 1}
                                            {id === me ? ' (you)' : ''}
                                            {id === instance.hostId ? ' · host' : ''}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                </section>

                <section className="game-send" aria-label="Send a payload">
                    <form className="game-send-form" onSubmit={handleSend}>
                        <label htmlFor="game-message" className="quiz-muted">Send to the game</label>
                        <input
                            id="game-message"
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            placeholder="Type a payload to send…"
                            maxLength={200}
                            autoComplete="off"
                        />
                        <button className="quiz-button" type="submit" disabled={sending || !message.trim()}>
                            {sending ? 'Sending…' : 'Send'}
                        </button>
                    </form>
                    {error && <p className="quiz-error center-text">{error}</p>}
                </section>

                <section className="game-ledger" aria-label="Payloads received">
                    <h2 className="center-text">Transactions ({ledger.transactions.length})</h2>
                    {ledger.transactions.length === 0
                        ? <p className="quiz-muted center-text">Nothing has been sent yet.</p>
                        : (
                            <ul className="quiz-list">
                                {ledger.transactions.map((transaction, index) => (
                                    <li
                                        key={`${transaction.sentAt ?? index}-${index}`}
                                        className="quiz-list-item game-transaction"
                                    >
                                        <span className="game-transaction-meta">
                                            <strong>{transaction.type}</strong>
                                            {' from '}
                                            {transaction.playerUUID === me ? 'you' : `player ${transaction.playerUUID.slice(0, 8)}`}
                                            {transaction.playerUUID === instance.hostId ? ' (host)' : ''}
                                        </span>
                                        <span className="game-transaction-payload">
                                            {renderPayload(transaction)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                </section>
            </main>
        </div>
    );
}

// Renders a transaction's payload for the ledger: objects are shown as JSON,
// primitives as plain text.
function renderPayload(transaction: Transaction): string {
    const payload = transaction.payload;
    if (payload == null) return '—';
    if (typeof payload === 'object') {
        try {
            return JSON.stringify(payload);
        } catch {
            return '—';
        }
    }
    return String(payload);
}

export default GamePage;
