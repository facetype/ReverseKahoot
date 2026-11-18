import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GamePhase, GameState, PlayerStanding } from '@/api/supabase/quiz-instance-api';
import GameFooter from './GameFooter.tsx';
import OptionGrid from './OptionGrid';
import ResultsPodium from './Resultspodium.tsx';
import ScoreboardPanel from './ScoreBoardPanel.tsx';
import SpiralBackground from './SpiralBackground.tsx';
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
    // Quiz title and error line, rendered at the top of the stage.
    header?: ReactNode;
}

// The shared screen: shows the answer options while a round is open and the
// question and results once it has ended. Only the host's actions move the game on.
function HostView({ game, players, betCount, remaining, advancing, onAdvance, header }: HostViewProps) {
    const [scoreboardOpen, setScoreboardOpen] = useState(false);
    const question = game.currentQuestion;
    const reveal = game.phase === 'reveal' ? game.lastReveal : null;
    const isLast = question ? question.index + 1 >= question.total : false;
    // Points only change at a reveal, so the scoreboard shows the last known standing.
    const standings = game.lastReveal?.standings ?? players;

    let stage: ReactNode = null;
    let actionLabel: string | undefined;
    let fromPhase: GamePhase | null = null;

    if (game.phase === 'lobby') {
        actionLabel = 'Start the first round';
        fromPhase = 'lobby';
        stage = (
            <section className="game-stage" aria-labelledby="game-heading">
                <h2 id="game-heading">Get ready</h2>
                <p className="quiz-muted center-text">
                    {players.length} {players.length === 1 ? 'player is' : 'players are'} in.
                </p>
                <Standings standings={players} />
            </section>
        );
    } else if (game.phase === 'finished') {
        const finalStandings = game.lastReveal?.standings ?? [];
        stage = (
            <section className="game-stage gameResultsContainer" aria-labelledby="game-heading">
                <SpiralBackground />
                <div className="gameResultsTextContainer">
                    <h2 id="game-heading">Final results</h2>
                    <p className="quiz-muted">The winners of today’s quiz are…</p>
                </div>
                <ResultsPodium standings={finalStandings} />
                {finalStandings.length > 3 && <Standings standings={finalStandings} offset={3} />}
                <p className="center-text"><Link className="quiz-link" to="/quizzes">Back to quizzes</Link></p>
            </section>
        );
    } else if (question) {
        fromPhase = game.phase === 'question' ? 'question' : 'reveal';
        actionLabel = game.phase === 'question' ? 'Reveal now' : isLast ? 'Final results' : 'Next question';
        stage = (
            <section className="game-stage" aria-labelledby="game-heading">
                {reveal && <SpiralBackground />}
                <div className="game-status">
                    <span>Question {question.index + 1} of {question.total}</span>
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

                {reveal && (
                    <>
                        <h3 className="center-text">Leaderboard</h3>
                        <Standings standings={reveal.standings ?? []} showResult limit={REVEAL_LEADERBOARD_SIZE} />
                    </>
                )}
            </section>
        );
    }

    const inLobby = game.phase === 'lobby';
    const finished = game.phase === 'finished';
    const counterText = game.phase === 'question' ? `${betCount}/${players.length}` : String(players.length);

    return (
        <>
            <div className="gameStateContainer">
                <div className="quiz-page game-page">
                    {header}
                    {stage}
                </div>
                {scoreboardOpen && !finished && (
                    <ScoreboardPanel standings={standings} onClose={() => setScoreboardOpen(false)} />
                )}
            </div>
            <GameFooter
                counterText={finished ? undefined : counterText}
                onToggleScoreboard={inLobby || finished ? undefined : () => setScoreboardOpen(open => !open)}
                scoreboardOpen={scoreboardOpen}
                actionLabel={actionLabel}
                actionDisabled={advancing}
                onAction={fromPhase ? () => onAdvance(fromPhase) : undefined}
            />
        </>
    );
}

export default HostView;