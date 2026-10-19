import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './client.ts';

export type GamePhase = 'lobby' | 'question' | 'reveal' | 'finished';

// One player's line on the leaderboard. wager and pointsWon refer to the question
// that was just revealed (zero in the lobby and for players who did not bet).
export interface PlayerStanding {
    userId: string;
    nickname: string;
    points: number;
    wager: number;
    pointsWon: number;
}

// The open question as everyone sees it: the clue ("text") and the four candidate
// questions. Which option is correct is only sent in the reveal.
export interface GameQuestion {
    questionId: number;
    index: number;
    total: number;
    text: string;
    options: { answerId: number; text: string }[];
    hints: { hintId: number; cost: number }[];
}

export interface GameReveal {
    questionId?: number;
    correctAnswerId?: number;
    // Keyed by answerId.
    betCounts?: Record<string, number>;
    standings: PlayerStanding[];
}

export interface GameState {
    phase: GamePhase;
    questionStartedAt: string | null;
    currentQuestion: GameQuestion | null;
    lastReveal: GameReveal | null;
}

// The caller's private view of the open question.
export interface PlayerState {
    nickname: string;
    points: number;
    bet: { answerId: number; wager: number } | null;
    hints: { hintId: number; text: string; cost: number }[];
}

// One live game session, as the frontend needs it. The edge functions return the
// full row for signed-in callers (or a trimmed view); both are normalised here.
export interface QuizInstanceSession {
    instanceId: string;
    quizId: number;
    hostId: string | null;
    joinCode: string;
    isStarted: boolean;
    attendingPlayers: string[];
    players: PlayerStanding[];
    game: GameState;
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
    players?: PlayerStanding[] | null;
    phase?: GamePhase | null;
    questionStartedAt?: string | null;
    currentQuestion?: GameQuestion | null;
    lastReveal?: GameReveal | null;
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
        players: row.players ?? [],
        game: {
            phase: row.phase ?? 'lobby',
            questionStartedAt: row.questionStartedAt ?? null,
            currentQuestion: row.currentQuestion ?? null,
            lastReveal: row.lastReveal ?? null,
        },
        channel: row.channel ?? `quiz-instance:${instanceId}`,
    };
}

// Creates a lobby for the quiz and returns its join code and realtime channel.
export async function createQuizInstance(quizId: number): Promise<QuizInstanceSession> {
    await ensureSession();
    return normalize(await invoke<RawInstance>('CreateQuizInstance', { quizId }));
}

// Joins the lobby with the given code, adding the caller to the player list.
// The nickname is ignored when the caller has already joined.
export async function joinQuizInstance(joinCode: string, nickname: string): Promise<JoinResult> {
    await ensureSession();
    const row = await invoke<RawInstance & { alreadyJoined?: boolean }>('JoinQuizInstance', { joinCode, nickname });
    return { ...normalize(row), alreadyJoined: Boolean(row.alreadyJoined) };
}

// The host starts the game; this flips isStarted and closes the lobby.
export async function startQuizInstance(instanceId: string): Promise<QuizInstanceSession> {
    await ensureSession();
    return normalize(await invoke<RawInstance>('StartQuizInstance', { instanceId }));
}

// Reads a game directly (after a reload, or to catch up once the realtime channel
// connects). RLS lets the host and the joined players read their own instance
// row and its players.
export async function getQuizInstance(instanceId: string): Promise<QuizInstanceSession> {
    const client = configured();
    const { data, error } = await client
        .from('QuizInstance')
        .select('id, quizId, hostId, joinCode, isStarted, attendingPlayers, gameId, phase, questionStartedAt, currentQuestion, lastReveal')
        .eq('id', instanceId)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('This game could not be found.');

    let players: PlayerStanding[] = [];
    if (data.gameId != null) {
        const { data: rows, error: playersError } = await client
            .from('GamePlayer')
            .select('userId, playerName, finalPoints')
            .eq('gameId', data.gameId)
            .order('playerId');
        if (playersError) throw playersError;
        players = (rows ?? []).map(p => ({
            userId: p.userId,
            nickname: p.playerName,
            points: p.finalPoints,
            wager: 0,
            pointsWon: 0,
        }));
    }
    return normalize({ ...(data as RawInstance), players });
}

// The host moves the game one step. fromPhase is the phase the host is looking
// at; if the game has already moved on, the server leaves it as it is.
export async function advanceGame(instanceId: string, fromPhase: GamePhase): Promise<GameState> {
    return invoke<GameState>('AdvanceQuizInstance', { instanceId, fromPhase });
}

export async function placeBet(instanceId: string, answerId: number, wager: number): Promise<PlayerState> {
    return invoke<PlayerState>('PlaceBet', { instanceId, answerId, wager });
}

export async function buyHint(instanceId: string, hintId: number): Promise<PlayerState> {
    return invoke<PlayerState>('BuyHint', { instanceId, hintId });
}

export async function getPlayerState(instanceId: string): Promise<PlayerState> {
    return invoke<PlayerState>('GetPlayerState', { instanceId });
}

export interface QuizChannelHandlers {
    onPlayerJoined?: (players: PlayerStanding[]) => void;
    onStarted?: () => void;
    onGameState?: (state: GameState) => void;
    onBetPlaced?: (betCount: number) => void;
    // Called once the channel is connected (re-read state here, since events sent
    // before that are missed) or when it fails, e.g. when RLS refuses access.
    onSubscribed?: () => void;
    onError?: (message: string) => void;
}

// Subscribes to the game's private realtime topic. The server broadcasts
// "player-joined", "game-started", "game-state" and "bet-placed"; access is
// gated by RLS on realtime.messages (see supabase/migrations).
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
            const players = (payload as { players?: PlayerStanding[] }).players ?? [];
            handlers.onPlayerJoined?.(players);
        })
        .on('broadcast', { event: 'game-started' }, () => {
            handlers.onStarted?.();
        })
        .on('broadcast', { event: 'game-state' }, ({ payload }) => {
            handlers.onGameState?.(payload as GameState);
        })
        .on('broadcast', { event: 'bet-placed' }, ({ payload }) => {
            handlers.onBetPlaced?.((payload as { betCount?: number }).betCount ?? 0);
        })
        .subscribe((status, err) => {
            if (status === 'SUBSCRIBED') handlers.onSubscribed?.();
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                handlers.onError?.(err?.message ?? 'Lost the live connection to the game. Reload to reconnect.');
            }
        });
    return channel;
}

export function unsubscribeFromQuizInstance(channel: RealtimeChannel | null): void {
    if (supabase && channel) void supabase.removeChannel(channel);
}
