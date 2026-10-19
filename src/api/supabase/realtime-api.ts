import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './client.ts';
import { ensureSession, invoke } from './functions.ts';

// Realtime plumbing for a quiz instance's private channel: subscribing to the
// events the server broadcasts, and sending member payloads through the
// SendQuizInstanceEvent edge function.

// Topic prefix for one game. Must match supabase/functions/_shared/realtime.ts.
const QUIZ_CHANNEL_PREFIX = 'quiz-instance:';

export function quizChannel(instanceId: string): string {
    return `${QUIZ_CHANNEL_PREFIX}${instanceId}`;
}

// Shape broadcast by the SendQuizInstanceEvent edge function: the caller's
// payload wrapped with server-verified sender information.
export interface QuizInstanceEventMessage {
    instanceId?: string;
    from?: string;
    sentAt?: string;
    payload?: unknown;
}

export interface QuizChannelHandlers {
    // Server event "player-joined": carries the full player list.
    onPlayerJoined?: (players: string[]) => void;
    // Server event "game-started": the lobby is closed, the game begins.
    onStarted?: () => void;
    // Any other event a member sent through sendQuizInstanceEvent.
    onEvent?: (event: string, message: QuizInstanceEventMessage) => void;
    // Fires once the private channel is actually listening (RLS-checked).
    onSubscribed?: () => void;
    // Fires when the channel errors or is closed by the server; a reload or
    // a rejoin (joinQuizInstance with the game's code) restores the session.
    onClosed?: () => void;
}

// Subscribes to the game's private realtime topic. RLS on realtime.messages
// (see supabase/migrations) limits the topic to the host and the joined
// players; a listener who is not a member has onClosed fire instead.
export function subscribeToQuizInstance(
    instanceId: string,
    handlers: QuizChannelHandlers,
): RealtimeChannel | null {
    if (!supabase) return null;
    const channel = supabase.channel(quizChannel(instanceId), {
        config: { private: true },
    });

    channel
        // One wildcard binding routes every broadcast on the topic, so member
        // payloads sent with sendQuizInstanceEvent arrive without re-subscribing.
        .on('broadcast', { event: '*' }, message => {
            const event = message.event;
            const payload = (message.payload ?? {}) as Record<string, unknown>;
            if (event === 'player-joined') {
                const players = payload.attendingPlayers ?? [];
                handlers.onPlayerJoined?.(players as string[]);
            } else if (event === 'game-started') {
                handlers.onStarted?.();
            } else {
                handlers.onEvent?.(event, payload as QuizInstanceEventMessage);
            }
        })
        .subscribe(status => {
            if (status === 'SUBSCRIBED') handlers.onSubscribed?.();
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                handlers.onClosed?.();
            }
        });

    return channel;
}

export function unsubscribeFromQuizInstance(channel: RealtimeChannel | null): void {
    if (supabase && channel) void supabase.removeChannel(channel);
}

// Sends one payload to everyone in the game via the SendQuizInstanceEvent edge
// function. Only members (host or joined players) may send; the server stamps
// the payload with the verified sender before broadcasting it.
export async function sendQuizInstanceEvent(
    instanceId: string,
    event: string,
    payload: Record<string, unknown>,
): Promise<void> {
    await ensureSession();
    await invoke('SendQuizInstanceEvent', { instanceId, event, payload });
}
