import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
    buyHint,
    getPlayerState,
    placeBet,
    type GameQuestion,
    type GameState,
    type PlayerStanding,
    type PlayerState,
} from '@/api/supabase/quiz-instance-api';
import BetSlider from './BetSlider';
import GameFooter from './GameFooter';
import OptionGrid from './OptionGrid';
import ResultsPodium from './Resultspodium';
import ScoreboardPanel from './ScoreBoardPanel';
import ShopPanel from './ShopPanel';
import SpiralBackground from './SpiralBackground';
import Standings from './Standings';

interface PlayerViewProps {
    instanceId: string;
    game: GameState;
    me: string | null;
    remaining: number | null;
    // Everyone in the game (starting points), and how many have bet this round.
    players: PlayerStanding[];
    betCount: number;
    // Quiz title and error line, rendered at the top of the stage.
    header?: ReactNode;
}

function errorText(e: unknown, fallback: string): string {
    return e instanceof Error ? e.message : fallback;
}

// A player's phone: buy hints, pick an option, bet, then see how it went.
function PlayerView({ instanceId, game, me, remaining, players, betCount, header }: PlayerViewProps) {
    const [state, setState] = useState<PlayerState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // The shop belongs to one round. Remembering which round it was opened for closes
    // it automatically when the round changes, without an effect to reset it.
    const roundKey = `${game.phase}:${game.currentQuestion?.questionId ?? ''}`;
    const [shopOpenFor, setShopOpenFor] = useState<string | null>(null);
    const shopOpen = shopOpenFor === roundKey;
    const [scoreboardOpen, setScoreboardOpen] = useState(false);
    const questionId = game.currentQuestion?.questionId ?? null;

    // Points, bet and hints change with every step of the game, so re-read them.
    useEffect(() => {
        let cancelled = false;
        getPlayerState(instanceId)
            .then(next => {
                if (!cancelled) setState(next);
            })
            .catch((e: unknown) => {
                if (!cancelled) setError(errorText(e, 'Could not load your points.'));
            });
        return () => {
            cancelled = true;
        };
    }, [instanceId, game.phase, questionId]);

    const standings = game.lastReveal?.standings ?? [];
    const myStanding = standings.find(s => s.userId === me) ?? null;
    const myRank = myStanding ? standings.indexOf(myStanding) + 1 : null;

    const question = game.currentQuestion;
    const timeUp = remaining === 0;
    const bought = new Set(state?.hints.map(h => h.hintId) ?? []);
    const shopAvailable =
        game.phase === 'question' && !!question && question.hints.length > 0 && !!state && !state.bet && !timeUp;

    const handleBuy = async (hintId: number) => {
        setBusy(true);
        setError(null);
        try {
            setState(await buyHint(instanceId, hintId));
        } catch (e: unknown) {
            setError(errorText(e, 'Could not buy the hint.'));
        } finally {
            setBusy(false);
        }
    };

    const finished = game.phase === 'finished';
    const scoreboardStandings = standings.length > 0 ? standings : players;
    const counterText = game.phase === 'question' ? `${betCount}/${players.length}` : String(players.length);

    return (
        <>
            <div className="gameStateContainer">
                {shopOpen && shopAvailable && question && state && (
                    <ShopPanel
                        hints={question.hints}
                        boughtIds={bought}
                        points={state.points}
                        busy={busy}
                        onBuy={hintId => void handleBuy(hintId)}
                        onClose={() => setShopOpenFor(null)}
                    />
                )}

                <div className="quiz-page game-page">
                    {header}
                    <section className="game-stage" aria-labelledby="game-heading">
                        {error && <p className="quiz-error" role="alert">{error}</p>}

                        {game.phase === 'lobby' && (
                            <>
                                <h2 id="game-heading">Get ready</h2>
                                <p className="quiz-muted">The first round is about to start.</p>
                            </>
                        )}

                        {game.phase === 'question' && question && state && (
                            <PlayerQuestion
                                key={question.questionId}
                                instanceId={instanceId}
                                question={question}
                                state={state}
                                remaining={remaining}
                                onState={setState}
                            />
                        )}

                        {game.phase === 'reveal' && question && (
                            <>
                                <SpiralBackground />
                                <p className="quiz-muted">The question was</p>
                                <h2 id="game-heading" className="game-clue">{game.lastReveal?.questionText ?? 'Round over'}</h2>
                                {state && (
                                    <p className="game-outcome" role="status">
                                        {!state.bet
                                            ? 'You did not bet on this one.'
                                            : state.bet.answerId === game.lastReveal?.correctAnswerId
                                                ? `Correct! +${state.bet.wager}`
                                                : `Wrong. -${state.bet.wager}`}
                                    </p>
                                )}
                                <OptionGrid
                                    options={question.options}
                                    selectedId={state?.bet?.answerId ?? null}
                                    correctAnswerId={game.lastReveal?.correctAnswerId}
                                />
                                {myRank && <p className="quiz-muted center-text">You are #{myRank} of {standings.length}.</p>}
                            </>
                        )}

                        {finished && (
                            <div className="gameResultsContainer">
                                <SpiralBackground />
                                <div className="gameResultsTextContainer">
                                    <h2 id="game-heading">Game over</h2>
                                    {myRank && myStanding && (
                                        <p className="game-outcome" role="status">
                                            You finished #{myRank} of {standings.length} with {myStanding.points} points.
                                        </p>
                                    )}
                                </div>
                                <ResultsPodium standings={standings} me={me} />
                                {standings.length > 3 && <Standings standings={standings} me={me} offset={3} />}
                                <p className="center-text"><Link className="quiz-link" to="/">Back home</Link></p>
                            </div>
                        )}
                    </section>
                </div>

                {scoreboardOpen && !finished && (
                    <ScoreboardPanel standings={scoreboardStandings} me={me} onClose={() => setScoreboardOpen(false)} />
                )}
            </div>

            <GameFooter
                points={state?.points ?? null}
                onToggleShop={shopAvailable ? () => setShopOpenFor(current => (current === roundKey ? null : roundKey)) : undefined}
                shopOpen={shopOpen}
                counterText={finished ? undefined : counterText}
                onToggleScoreboard={game.phase === 'lobby' || finished ? undefined : () => setScoreboardOpen(open => !open)}
                scoreboardOpen={scoreboardOpen}
            />
        </>
    );
}

interface PlayerQuestionProps {
    instanceId: string;
    question: GameQuestion;
    state: PlayerState;
    remaining: number | null;
    onState: (state: PlayerState) => void;
}

// Keyed by question, so the pick and the wager start fresh for every question.
function PlayerQuestion({ instanceId, question, state, remaining, onState }: PlayerQuestionProps) {
    const [selected, setSelected] = useState<number | null>(null);
    const [wager, setWager] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const timeUp = remaining === 0;
    const bet = state.bet;
    // Points can drop after a hint purchase; never offer more than is left.
    const maxWager = state.points;
    const shownWager = Math.min(wager, maxWager);

    const handleBet = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (selected === null) {
            setError('Pick an answer first.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            onState(await placeBet(instanceId, selected, shownWager));
        } catch (err: unknown) {
            setError(errorText(err, 'Could not place your bet.'));
        } finally {
            setBusy(false);
        }
    };

    const optionText = (answerId: number) =>
        question.options.find(o => o.answerId === answerId)?.text ?? '';

    return (
        <>
            <div className="game-status">
                <span>Question {question.index + 1} of {question.total}</span>
                <span className="game-timer" aria-label={`${remaining ?? 0} seconds left`}>{remaining ?? 0}</span>
            </div>
            <p className="quiz-muted">
                The question is hidden until the round ends.
                {question.hints.length > 0 && ' Open the shop to buy a hint, then bet on an answer.'}
            </p>
            <h2 id="game-heading" className="game-clue">Place your bets</h2>

            {state.hints.length > 0 && (
                <ul className="game-hints" aria-label="Your hints">
                    {state.hints.map(h => <li key={h.hintId}>{h.text}</li>)}
                </ul>
            )}

            {bet
                ? (
                    <>
                        <OptionGrid
                            options={question.options}
                            selectedId={bet.answerId}
                            disabled
                            selectedBadge={`${bet.wager} pts`}
                        />
                        <p className="game-outcome" role="status">
                            You bet {bet.wager} on “{optionText(bet.answerId)}”. Waiting for the reveal…
                        </p>
                    </>
                )
                : timeUp
                    ? <p className="game-outcome" role="status">Time is up. No bet this round.</p>
                    : (
                        <form className="game-bet" onSubmit={e => void handleBet(e)}>
                            <OptionGrid
                                options={question.options}
                                selectedId={selected}
                                onSelect={setSelected}
                                disabled={busy}
                                selectedBadge={selected !== null && shownWager > 0 ? `${shownWager} pts` : undefined}
                            />

                            <label className="quiz-field" htmlFor="game-wager">
                                Your bet: {shownWager} of {maxWager} pts
                            </label>
                            <div className="game-wager">
                                <BetSlider
                                    value={shownWager}
                                    max={maxWager}
                                    onChange={setWager}
                                    disabled={busy}
                                />
                                <input
                                    id="game-wager"
                                    type="number"
                                    min={0}
                                    max={maxWager}
                                    step={1}
                                    inputMode="numeric"
                                    value={shownWager}
                                    onChange={e => setWager(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                                    disabled={busy}
                                />
                            </div>
                            <button className="quiz-button" type="submit" disabled={busy || selected === null}>
                                {busy ? 'Placing…' : 'Place bet'}
                            </button>
                        </form>
                    )}
            {error && <p className="quiz-error" role="alert">{error}</p>}
        </>
    );
}

export default PlayerView;