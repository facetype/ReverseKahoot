import { Link } from 'react-router-dom';
import type { GamePhase, GameState, PlayerStanding } from '@/api/supabase/quiz-instance-api';
import OptionGrid from './OptionGrid';
import Standings from './Standings';

// How many players the reveal leaderboard shows on the shared screen.
const REVEAL_LEADERBOARD_SIZE = 5;

interface HostViewProps {
    game: GameState;
    players: PlayerStanding[];
    betCount: number;
    remaining: number | null;
    advancing: boolean;
    onAdvance: (fromPhase: GamePhase) => void;
}

// The shared screen: shows the answer, the four candidate questions and the
// results. Only the host's actions move the game on.
function HostView({ game, players, betCount, remaining, advancing, onAdvance }: HostViewProps) {
    const question = game.currentQuestion;

    if (game.phase === 'lobby') {
        return (
            <section className="game-stage" aria-labelledby="game-heading">
                <h2 id="game-heading">Get ready</h2>
                <p className="quiz-muted">{players.length} {players.length === 1 ? 'player is' : 'players are'} in.</p>
                <Standings standings={players} />
                <p className="center-text">
                    <button className="quiz-button" type="button" onClick={() => onAdvance('lobby')} disabled={advancing}>
                        Start the first round
                    </button>
                </p>
            </section>
        );
    }

    if (game.phase === 'finished') {
        return (
            <section className="game-stage" aria-labelledby="game-heading">
                <h2 id="game-heading">Final results</h2>
                <Standings standings={game.lastReveal?.standings ?? []} />
                <p className="center-text"><Link className="quiz-link" to="/quizzes">End Game</Link></p>
            </section>
        );
    }

    if (!question) return null;
    const isLast = question.index + 1 >= question.total;
    const reveal = game.phase === 'reveal' ? game.lastReveal : null;

    return (
        <section className="game-stage" aria-labelledby="game-heading">
            <div className="game-status">
                <span>Answer {question.index + 1} of {question.total}</span>
                {game.phase === 'question' && (
                    <span className="game-timer" aria-label={`${remaining ?? 0} seconds left`}>{remaining ?? 0}</span>
                )}
            </div>
            {reveal
                ? (
                    <>
                        <p className="quiz-muted">The question was</p>
                        <h2 id="game-heading" className="game-clue">{reveal.questionText ?? 'Round over'}</h2>
                    </>
                )
                : (
                    <>
                        <p className="quiz-muted">The question is hidden until the round ends.</p>
                        <h2 id="game-heading" className="game-clue">Place your bets</h2>
                    </>
            )}

            <OptionGrid
                options={question.options}
                correctAnswerId={reveal?.correctAnswerId}
                betCounts={reveal?.betCounts}
            />

            {game.phase === 'question'
                ? (
                    <>
                        <p className="quiz-muted center-text" role="status">
                            {betCount} of {players.length} bets placed
                        </p>
                        <p className="center-text">
                            <button className="quiz-button" type="button" onClick={() => onAdvance('question')} disabled={advancing}>
                                Reveal now
                            </button>
                        </p>
                    </>
                )
                : (
                    <>
                        <h3 className="center-text">Leaderboard</h3>
                        <Standings standings={reveal?.standings ?? []} showResult limit={REVEAL_LEADERBOARD_SIZE} />
                        <p className="center-text">
                            <button className="quiz-button" type="button" onClick={() => onAdvance('reveal')} disabled={advancing}>
                                {isLast ? 'Final results' : 'Next answer'}
                            </button>
                        </p>
                    </>
                )}
        </section>
    );
}

export default HostView;
