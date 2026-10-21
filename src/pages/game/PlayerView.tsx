import { useEffect, useState, type FormEvent } from 'react';
import {
    buyHint,
    getPlayerState,
    placeBet,
    type GameQuestion,
    type GameState,
    type PlayerState,
} from '@/api/supabase/quiz-instance-api';
import BetSlider from './BetSlider';
import OptionGrid from './OptionGrid';
import Standings from './Standings';

interface PlayerViewProps {
    instanceId: string;
    game: GameState;
    me: string | null;
    remaining: number | null;
}

function errorText(e: unknown, fallback: string): string {
    return e instanceof Error ? e.message : fallback;
}

// A player's phone: buy hints, pick an option, bet, then see how it went.
function PlayerView({ instanceId, game, me, remaining }: PlayerViewProps) {
    const [state, setState] = useState<PlayerState | null>(null);
    const [error, setError] = useState<string | null>(null);
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

    return (
        <section className="game-stage" aria-labelledby="game-heading">
            <div className="game-status">
                <span>{state?.nickname ?? 'You'}</span>
                <span className="game-my-points">{state?.points ?? '…'} pts</span>
            </div>
            {error && <p className="quiz-error" role="alert">{error}</p>}

            {game.phase === 'lobby' && (
                <>
                    <h2 id="game-heading">Get ready</h2>
                    <p className="quiz-muted">The host is about to show the first answer.</p>
                </>
            )}

            {game.phase === 'question' && game.currentQuestion && state && (
                <PlayerQuestion
                    key={game.currentQuestion.questionId}
                    instanceId={instanceId}
                    question={game.currentQuestion}
                    state={state}
                    remaining={remaining}
                    onState={setState}
                />
            )}

            {game.phase === 'reveal' && game.currentQuestion && (
                <>
                    <h2 id="game-heading" className="game-clue">{game.currentQuestion.text}</h2>
                    <p className="game-outcome" role="status">
                        {!state?.bet
                            ? 'You did not bet on this one.'
                            : state.bet.answerId === game.lastReveal?.correctAnswerId
                                ? `Correct! +${state.bet.wager}`
                                : `Wrong. -${state.bet.wager}`}
                    </p>
                    <OptionGrid
                        options={game.currentQuestion.options}
                        selectedId={state?.bet?.answerId ?? null}
                        correctAnswerId={game.lastReveal?.correctAnswerId}
                    />
                    {myRank && <p className="quiz-muted center-text">You are #{myRank} of {standings.length}.</p>}
                </>
            )}

            {game.phase === 'finished' && (
                <>
                    <h2 id="game-heading">Game over</h2>
                    {myRank && myStanding && (
                        <p className="game-outcome" role="status">
                            You finished #{myRank} of {standings.length} with {myStanding.points} points.
                        </p>
                    )}
                    <Standings standings={standings} me={me} />
                </>
            )}
        </section>
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
    const boughtIds = new Set(state.hints.map(h => h.hintId));
    const forSale = question.hints.filter(h => !boughtIds.has(h.hintId));
    // Points can drop after a hint purchase; never offer more than is left.
    const maxWager = state.points;
    const shownWager = Math.min(wager, maxWager);

    const run = async (action: () => Promise<PlayerState>, fallback: string) => {
        setBusy(true);
        setError(null);
        try {
            onState(await action());
        } catch (e: unknown) {
            setError(errorText(e, fallback));
        } finally {
            setBusy(false);
        }
    };

    const handleBet = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (selected === null) {
            setError('Pick the question you think fits.');
            return;
        }
        void run(() => placeBet(instanceId, selected, shownWager), 'Could not place your bet.');
    };

    const optionText = (answerId: number) =>
        question.options.find(o => o.answerId === answerId)?.text ?? '';

    return (
        <>
            <div className="game-status">
                <span>Answer {question.index + 1} of {question.total}</span>
                <span className="game-timer" aria-label={`${remaining ?? 0} seconds left`}>{remaining ?? 0}</span>
            </div>
            <p className="quiz-muted">Which question fits this answer?</p>
            <h2 id="game-heading" className="game-clue">{question.text}</h2>

            {state.hints.length > 0 && (
                <ul className="game-hints" aria-label="Your hints">
                    {state.hints.map(h => <li key={h.hintId}>{h.text}</li>)}
                </ul>
            )}

            {bet
                ? (
                    <p className="game-outcome" role="status">
                        You bet {bet.wager} on “{optionText(bet.answerId)}”. Waiting for the reveal…
                    </p>
                )
                : timeUp
                    ? <p className="game-outcome" role="status">Time is up. No bet this round.</p>
                    : (
                        <form className="game-bet" onSubmit={handleBet}>
                            {forSale.length > 0 && (
                                <div className="game-hint-shop">
                                    {forSale.map((hint, index) => (
                                        <button
                                            key={hint.hintId}
                                            type="button"
                                            className="quiz-button game-hint-button"
                                            onClick={() => void run(() => buyHint(instanceId, hint.hintId), 'Could not buy the hint.')}
                                            disabled={busy || hint.cost > state.points}
                                        >
                                            Buy hint {state.hints.length + index + 1} ({hint.cost} pts)
                                        </button>
                                    ))}
                                </div>
                            )}

                            <OptionGrid
                                options={question.options}
                                selectedId={selected}
                                onSelect={setSelected}
                                disabled={busy}
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