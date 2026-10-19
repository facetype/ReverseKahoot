import { supabase } from './client.ts';
import { ensureSession, invoke } from './functions.ts';

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
    // True when the caller was already a member: nothing changed on the row.
    // This is also what a reconnect after the game started looks like.
    alreadyJoined: boolean;
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
// Members of a started game get their instance back (alreadyJoined: true),
// which is the reconnect path; strangers are turned away with a 409.
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
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase
        .from('QuizInstance')
        .select('id, quizId, hostId, joinCode, isStarted, attendingPlayers')
        .eq('id', instanceId)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This game could not be found.');
    return normalize(data as RawInstance);
}

// True when the user is the host of the instance or is on its player list.
export function isQuizInstanceMember(
    instance: QuizInstanceSession,
    userId: string | null | undefined,
): boolean {
    if (!userId) return false;
    return instance.hostId === userId || instance.attendingPlayers.includes(userId);
}
