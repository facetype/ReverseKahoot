import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './client.ts';

// One live game session, as the frontend needs it. The edge functions return the
// full row for signed-in callers (or a trimmed view); both are normalised here.
export interface QuizInstanceSession {
    instanceId: string;
    quizId: number;
    hostId: string | null;
    joinCode: string;
    isStarted: boolean;
    attendingPlayers: string[];
    // Private realtime topic the host and players subscribe to.
    channel: string;
}

export interface JoinResult extends QuizInstanceSession {
    alreadyJoined: boolean;
}

function configured() {
    if (!supabase) throw new Error('Supabase is not configured.');
    return supabase;
}

// Players do not need an account: the edge functions key off the JWT, so sign the
// caller in anonymously when there is no session yet. No-op when already signed in.
export async function ensureSession(): Promise<string> {
    const client = configured();
    const { data } = await client.auth.getSession();
    if (data.session) return data.session.user.id;

    const { data: anon, error } = await client.auth.signInAnonymously();
    if (error || !anon.user) {
        throw new Error(
            error?.message && /anonymous/i.test(error.message)
                ? 'Guest join is disabled; sign in to join a game.'
                : error?.message ?? 'Could not start a guest session.',
        );
    }
    return anon.user.id;
}

// Edge functions return { error } with a non-2xx status; supabase-js hides the
// body inside error.context, so read it to surface the real message.
async function errorMessage(error: unknown): Promise<string> {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
        try {
            const body = (await context.json()) as { error?: unknown };
            if (typeof body?.error === 'string') return body.error;
        } catch {
            // fall through to the generic message
        }
    }
    return error instanceof Error ? error.message : 'The request failed.';
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const client = configured();
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) throw new Error(await errorMessage(error));
    return data as T;
}

interface RawInstance {
    id?: string;
    instanceId?: string;
    quizId?: number;
    hostId?: string | null;
    joinCode?: string;
    isStarted?: boolean | null;
    attendingPlayers?: string[] | null;
    channel?: string;
}

function normalize(row: RawInstance): QuizInstanceSession {
    const instanceId = row.instanceId ?? row.id;
    if (!instanceId) throw new Error('The game response was missing an id.');
    return {
        instanceId,
        quizId: row.quizId ?? 0,
        hostId: row.hostId ?? null,
        joinCode: row.joinCode ?? '',
        isStarted: row.isStarted ?? false,
        attendingPlayers: row.attendingPlayers ?? [],
        channel: row.channel ?? `quiz-instance:${instanceId}`,
    };
}

// Creates a lobby for the quiz and returns its join code and realtime channel.
export async function createQuizInstance(quizId: number): Promise<QuizInstanceSession> {
    await ensureSession();
    return normalize(await invoke<RawInstance>('CreateQuizInstance', { quizId }));
}

// Joins the lobby with the given code, adding the caller to the player list.
export async function joinQuizInstance(joinCode: string): Promise<JoinResult> {
    await ensureSession();
    const row = await invoke<RawInstance & { alreadyJoined?: boolean }>('JoinQuizInstance', { joinCode });
    return { ...normalize(row), alreadyJoined: Boolean(row.alreadyJoined) };
}

// The host starts the game; this flips isStarted and closes the lobby.
export async function startQuizInstance(instanceId: string): Promise<QuizInstanceSession> {
    await ensureSession();
    return normalize(await invoke<RawInstance>('StartQuizInstance', { instanceId }));
}

// Reads a lobby directly (used after a reload). RLS lets the host and the joined
// players read their own instance row.
export async function getQuizInstance(instanceId: string): Promise<QuizInstanceSession> {
    const client = configured();
    const { data, error } = await client
        .from('QuizInstance')
        .select('id, quizId, hostId, joinCode, isStarted, attendingPlayers')
        .eq('id', instanceId)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This game could not be found.');
    return normalize(data as RawInstance);
}

export interface QuizChannelHandlers {
    onPlayerJoined?: (players: string[]) => void;
    onStarted?: () => void;
}

// Subscribes to the game's private realtime topic. The server broadcasts
// "player-joined" and "game-started"; access is gated by RLS on
// realtime.messages (see supabase/migrations).
export function subscribeToQuizInstance(
    instanceId: string,
    handlers: QuizChannelHandlers,
): RealtimeChannel | null {
    if (!supabase) return null;
    const channel = supabase.channel(`quiz-instance:${instanceId}`, {
        config: { private: true },
    });
    channel
        .on('broadcast', { event: 'player-joined' }, ({ payload }) => {
            const players = (payload as { attendingPlayers?: string[] }).attendingPlayers ?? [];
            handlers.onPlayerJoined?.(players);
        })
        .on('broadcast', { event: 'game-started' }, () => {
            handlers.onStarted?.();
        })
        .subscribe();
    return channel;
}

export function unsubscribeFromQuizInstance(channel: RealtimeChannel | null): void {
    if (supabase && channel) void supabase.removeChannel(channel);
}
