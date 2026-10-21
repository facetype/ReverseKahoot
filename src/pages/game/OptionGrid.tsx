import type { GameQuestion } from '@/api/supabase/quiz-instance-api';

const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

interface OptionGridProps {
    options: GameQuestion['options'];
    // Players pick an option; the host screen only displays them.
    selectedId?: number | null;
    onSelect?: (answerId: number) => void;
    disabled?: boolean;
    // Set after the reveal.
    correctAnswerId?: number;
    betCounts?: Record<string, number>;
}

function OptionGrid({ options, selectedId = null, onSelect, disabled = false, correctAnswerId, betCounts }: OptionGridProps) {
    const revealed = correctAnswerId !== undefined;

    return (
        <ul className="game-options" aria-label="Which answer fits?">
            {options.map((option, index) => {
                const letter = OPTION_LETTERS[index] ?? String(index + 1);
                const classes = [
                    'game-option',
                    `game-option-${index + 1}`,
                    option.answerId === selectedId ? 'game-option-selected' : '',
                    revealed && option.answerId === correctAnswerId ? 'game-option-correct' : '',
                    revealed && option.answerId !== correctAnswerId ? 'game-option-dimmed' : '',
                ].filter(Boolean).join(' ');
                const count = betCounts?.[String(option.answerId)] ?? 0;
                const content = (
                    <>
                        <span className="game-option-letter" aria-hidden="true">{letter}</span>
                        <span className="game-option-text">{option.text}</span>
                        <span className="game-option-meta">
                            {revealed && option.answerId === correctAnswerId && <span>Correct</span>}
                            {betCounts && <span>{count} {count === 1 ? 'bet' : 'bets'}</span>}
                        </span>
                    </>
                );

                return (
                    <li key={option.answerId}>
                        {onSelect
                            ? (
                                <button
                                    type="button"
                                    className={classes}
                                    onClick={() => onSelect(option.answerId)}
                                    disabled={disabled}
                                    aria-pressed={option.answerId === selectedId}
                                    aria-label={`${letter}: ${option.text}`}
                                >
                                    {content}
                                </button>
                            )
                            : <div className={classes}>{content}</div>}
                    </li>
                );
            })}
        </ul>
    );
}

export default OptionGrid;
