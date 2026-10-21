import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useSession } from '@/pages/auth/useSession';
import {
    getQuizInstance,
    startQuizInstance,
    subscribeToQuizInstance,
    unsubscribeFromQuizInstance,
    type QuizInstanceSession,
} from '@/api/supabase/quiz-instance-api';
import Navbar from '@/common/components/navbar/navbar';
import '@/common/styles/quiz.css';

interface LobbyNavState {
    instance?: QuizInstanceSession;
    quizTitle?: string;
    isHost?: boolean;
}

function Lobby() {
    const { instanceId = '' } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const navState = (location.state as LobbyNavState | null) ?? null;
    const { session } = useSession();

    const [instance, setInstance] = useState<QuizInstanceSession | null>(navState?.instance ?? null);
    const [quizTitle] = useState<string | null>(navState?.quizTitle ?? null);
    const [loading, setLoading] = useState(!navState?.instance);
    const [error, setError] = useState<string | null>(null);
    const [starting, setStarting] = useState(false);

    // Recover the lobby after a reload: the navigation state is gone, so read the
    // row. RLS allows the host and the joined players to read their own instance.
    useEffect(() => {
        if (instance || !instanceId) return;
        let cancelled = false;
        getQuizInstance(instanceId)
            .then(row => {
                if (!cancelled) {
                    setInstance(row);
                    setLoading(false);
                }
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
    }, [instance, instanceId]);

    // Subscribe to the game's realtime topic while we are in the lobby. Joins sent
    // before the channel connected are missed, so re-read the lobby once it has.
    useEffect(() => {
        if (!instanceId) return;
        const channel = subscribeToQuizInstance(instanceId, {
            onPlayerJoined: players =>
                setInstance(prev => (prev ? { ...prev, players } : prev)),
            onStarted: () => setInstance(prev => (prev ? { ...prev, isStarted: true } : prev)),
            onSubscribed: () => {
                getQuizInstance(instanceId)
                    .then(row => setInstance(prev => (prev ? { ...prev, players: row.players, isStarted: row.isStarted } : row)))
                    .catch(() => {
                        // The lobby already shows what it has; the next event refreshes it.
                    });
            },
            onError: setError,
        });
        return () => unsubscribeFromQuizInstance(channel);
    }, [instanceId]);

    const isHost =
        navState?.isHost ??
        (session?.user.id != null && session.user.id === instance?.hostId);

    const handleStart = async () => {
        if (!instance) return;
        setStarting(true);
        setError(null);
        try {
            await startQuizInstance(instance.instanceId);
            navigate(`/game/${instance.instanceId}`, { state: { quizTitle } });
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not start the game.');
        } finally {
            setStarting(false);
        }
    };

    if (loading) {
        return (
            <div>
                <Navbar />
                <div className="quiz-page">
                    <p className="quiz-muted center-text">Loading lobby…</p>
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

    // Everyone moves to the game page once the host has started.
    if (instance.isStarted) {
        return <Navigate to={`/game/${instance.instanceId}`} state={{ quizTitle }} replace />;
    }

    const players = instance.players;
    const me = session?.user.id ?? null;

    return (
        <div>
            <Navbar />
            <div className="quiz-page">
                <h1 className="center-text">{quizTitle ?? 'Lobby'}</h1>
                <br />
                <section className="quiz-hosted" role="status" aria-label="Game code">
                    {isHost && <p className="quiz-muted">Share this code with players</p>}
                    <p className="quiz-code">{instance.joinCode}</p>
                    {isHost && <p className="quiz-muted">Players enter it on the home page to join.</p>}
                </section>

                {error && <p className="quiz-error center-text">{error}</p>}

                <h2 className="center-text">Players ({players.length})</h2>
                {players.length === 0
                    ? <p className="quiz-muted center-text">No one has joined yet.</p>
                    : (
                        <ul className="quiz-list">
                            {players.map(player => (
                                <li key={player.userId} className="quiz-list-item">
                                    <span>
                                        {player.nickname}
                                        {player.userId === me ? ' (you)' : ''}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                {isHost
                    ? (
                        <p className="center-text">
                            <button
                                className="quiz-button"
                                type="button"
                                onClick={handleStart}
                                disabled={starting || players.length === 0}
                            >
                                {starting ? 'Starting…' : 'Start game'}
                            </button>
                        </p>
                    )
                    : (
                        <p className="quiz-muted center-text">
                            Waiting for the host to start…
                        </p>
                    )}
            </div>
        </div>
    );
}

export default Lobby;
