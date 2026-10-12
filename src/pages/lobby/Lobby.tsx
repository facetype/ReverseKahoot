import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
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

    // Subscribe to the game's realtime topic while we are in the lobby.
    useEffect(() => {
        if (!instanceId) return;
        const channel = subscribeToQuizInstance(instanceId, {
            onPlayerJoined: players =>
                setInstance(prev => (prev ? { ...prev, attendingPlayers: players } : prev)),
            onStarted: () => setInstance(prev => (prev ? { ...prev, isStarted: true } : prev)),
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
            const started = await startQuizInstance(instance.instanceId);
            setInstance(prev => (prev ? { ...prev, isStarted: started.isStarted } : prev));
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

    const players = instance.attendingPlayers;
    const me = session?.user.id ?? null;

    return (
        <div>
            <Navbar />
            <div className="quiz-page">
                <h1 className="center-text">{quizTitle ?? 'Lobby'}</h1>
                <br />
                <section className="quiz-hosted" role="status" aria-label="Game code">
                    <p className="quiz-muted">Share this code with players</p>
                    <p className="quiz-code">{instance.joinCode}</p>
                    <p className="quiz-muted">Players enter it on the home page to join.</p>
                </section>

                {error && <p className="quiz-error center-text">{error}</p>}

                <h2 className="center-text">Players ({players.length})</h2>
                {players.length === 0
                    ? <p className="quiz-muted center-text">No one has joined yet.</p>
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

                {isHost
                    ? (
                        <p className="center-text">
                            <button
                                className="quiz-button"
                                type="button"
                                onClick={handleStart}
                                disabled={starting || instance.isStarted}
                            >
                                {instance.isStarted ? 'Game started' : starting ? 'Starting…' : 'Start game'}
                            </button>
                        </p>
                    )
                    : (
                        <p className="quiz-muted center-text">
                            {instance.isStarted ? 'The game has started.' : 'Waiting for the host to start…'}
                        </p>
                    )}
            </div>
        </div>
    );
}

export default Lobby;
