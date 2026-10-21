import { useRef, type KeyboardEvent } from 'react';

interface BetSliderProps {
    value: number;
    max: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}

// Tick spacing that gives roughly 4 to 10 ticks across the slider, always a
// "round" number (1, 2, 5 times a power of ten).
function tickStep(max: number): number {
    if (max <= 10) return 1;
    const rough = max / 8;
    const power = 10 ** Math.floor(Math.log10(rough));
    for (const factor of [1, 2, 5, 10]) {
        if (factor * power >= rough) return factor * power;
    }
    return 10 * power;
}

// Pointer drags snap to a tick when they land within this share of the track.
const SNAP_FRACTION = 0.015;

function BetSlider({ value, max, onChange, disabled = false }: BetSliderProps) {
    const usingKeyboard = useRef(false);
    const step = tickStep(max);
    const ticks: number[] = [];
    for (let t = 0; t <= max; t += step) ticks.push(t);
    if (ticks[ticks.length - 1] !== max) {
        if (max - ticks[ticks.length - 1] < step / 2) ticks.pop();
        ticks.push(max);
    }

    const snap = (raw: number): number => {
        if (usingKeyboard.current || max === 0) return raw;
        const nearest = ticks.reduce((best, t) => (Math.abs(t - raw) < Math.abs(best - raw) ? t : best), ticks[0]);
        return Math.abs(nearest - raw) <= max * SNAP_FRACTION ? nearest : raw;
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        usingKeyboard.current = e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page');
    };

    // Drop the "narrow" labels when ticks sit too close together to read.
    const labelEvery = ticks.length > 7 ? 2 : 1;

    return (
        <div className="bet-slider">
            <input
                type="range"
                min={0}
                max={max}
                step={1}
                value={value}
                onChange={e => onChange(snap(Number(e.target.value)))}
                onKeyDown={handleKeyDown}
                onPointerDown={() => { usingKeyboard.current = false; }}
                aria-label="Bet amount slider"
                disabled={disabled || max === 0}
            />
            <div className="bet-slider-ticks" aria-hidden="true">
                {ticks.map((t, i) => {
                    const fraction = max === 0 ? 0 : t / max;
                    const isEnd = t === max;
                    const showLabel = isEnd || i % labelEvery === 0;
                    return (
                        <button
                            key={t}
                            type="button"
                            tabIndex={-1}
                            className={`bet-slider-tick${t === value ? ' bet-slider-tick-active' : ''}`}
                            style={{ left: `calc(0.5rem + (100% - 1rem) * ${fraction})` }}
                            onClick={() => onChange(t)}
                            disabled={disabled || max === 0}
                        >
                            <span className="bet-slider-mark" />
                            {showLabel && <span className="bet-slider-label">{t}</span>}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export default BetSlider;