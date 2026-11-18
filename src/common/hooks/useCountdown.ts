import { useEffect, useState } from 'react';

const TICK_MS = 250;

// Whole seconds left until startedAt + seconds, ticking down to 0. Null when
// there is no start time. Uses the local clock, so a device whose clock is off
// shows the deadline a little early or late; the server enforces the real one.
export function useCountdown(startedAt: string | null, seconds: number): number | null {
    const deadline = startedAt ? Date.parse(startedAt) + seconds * 1000 : null;
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (deadline === null) return;
        const timer = window.setInterval(() => {
            setNow(Date.now());
            if (Date.now() >= deadline) window.clearInterval(timer);
        }, TICK_MS);
        return () => window.clearInterval(timer);
    }, [deadline]);

    if (deadline === null) return null;
    return Math.max(0, Math.ceil((deadline - now) / 1000));
}
