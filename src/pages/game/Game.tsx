import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useSession } from '@/pages/auth/useSession';
import {
    advanceGame,
    getQuizInstance,
    subscribeToQuizInstance,
    unsubscribeFromQuizInstance,
    type GamePhase,
    type GameState,
    type QuizInstanceSession,
} from '@/api/supabase/quiz-instance-api';
import { useCountdown } from '@/common/hooks/useCountdown';
import { QUESTION_TIME_LIMIT_SECONDS } from '@/common/constants/game';
import Navbar from '@/common/components/navbar/navbar';
import HostView from './HostView';
import PlayerView from './PlayerView';
import '@/common/styles/quiz.css';
import './Game.css';

function Game() {
    const { instanceId = '' } = useParams();
    const location = useLocation();
    const quizTitle = (location.state as { quizTitle?: string } | null)?.quizTitle ?? null;
    const { session, loading: sessionLoading } = useSession();

    const [instance, setInstance] = useState<QuizInstanceSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [betCount, setBetCount] = useState(0);
    const [advancing, setAdvancing] = useState(false);

    const applyGameState = useCallback((state: GameState) => {
        setInstance(prev => (prev ? { ...prev, game: state } : prev));
        if (state.phase === 'question') setBetCount(0);
    }, []);

    useEffect(() => {
        if (!instanceId) return;
        let cancelled = false;
        const load = () =>
            getQuizInstance(instanceId)
                .then(row => {
                    if (!cancelled) setInstance(row);
                })
                .catch((e: unknown) => {
                    if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the game.');
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });

        void load();
        // Steps sent before the channel connected are missed, so re-read the row then.
        const channel = subscribeToQuizInstance(instanceId, {
            onGameState: applyGameState,
            onBetPlaced: setBetCount,
            onSubscribed: () => void load(),
            onError: setError,
        });
        return () => {
            cancelled = true;
            unsubscribeFromQuizInstance(channel);
        };
    }, [instanceId, applyGameState]);

    const me = session?.user.id ?? null;
    const isHost = me !== null && me === instance?.hostId;
    const game = instance?.game ?? null;
    const remaining = useCountdown(
        game?.phase === 'question' ? game.questionStartedAt : null,
        QUESTION_TIME_LIMIT_SECONDS,
    );

    const advance = useCallback(async (fromPhase: GamePhase) => {
        setAdvancing(true);
        setError(null);
        try {
            applyGameState(await advanceGame(instanceId, fromPhase));
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Could not move the game on.');
        } finally {
            setAdvancing(false);
        }
    }, [instanceId, applyGameState]);

    // The host's screen reveals the answer when the countdown runs out. Once per
    // question; the server ignores the call anyway if the host already revealed.
    const autoRevealedFor = useRef<number | null>(null);
    const openQuestionId = game?.phase === 'question' ? game.currentQuestion?.questionId ?? null : null;
    useEffect(() => {
        if (!isHost || openQuestionId === null || remaining !== 0) return;
        if (autoRevealedFor.current === openQuestionId) return;
        autoRevealedFor.current = openQuestionId;
        void advance('question');
    }, [isHost, openQuestionId, remaining, advance]);

    if (loading || sessionLoading) {
        return (
            <div>
                <Navbar />
                <div className="quiz-page">
                    <p className="quiz-muted center-text">Loading game…</p>
                </div>
            </div>
        );
    }

    if (!instance || !game) {
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

    // Until the host starts, everyone belongs in the lobby.
    if (!instance.isStarted) {
        return <Navigate to={`/lobby/${instance.instanceId}`} state={{ quizTitle }} replace />;
    }

    return (
        <div>
            <Navbar />
            <div className="quiz-page game-page">
                {quizTitle && <p className="quiz-muted center-text">{quizTitle}</p>}
                {error && <p className="quiz-error center-text" role="alert">{error}</p>}
                {isHost
                    ? (
                        <HostView
                            game={game}
                            players={instance.players}
                            betCount={betCount}
                            remaining={remaining}
                            advancing={advancing}
                            onAdvance={fromPhase => void advance(fromPhase)}
                        />
                    )
                    : <PlayerView instanceId={instance.instanceId} game={game} me={me} remaining={remaining} />}
            </div>
        </div>
    );
}

export default Game;
