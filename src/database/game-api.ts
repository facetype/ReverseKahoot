import { supabase } from '../utils/supabase/supabase.ts';
import type { HostedGame } from './types';

export const JOIN_CODE_LENGTH = 6;
// No 0/O, 1/I/L: codes are read off a shared screen and typed on phones.
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_CODE_ATTEMPTS = 5;
// Postgres error code for a unique constraint violation.
const UNIQUE_VIOLATION = '23505';

export function generateGameCode(): string {
    const bytes = crypto.getRandomValues(new Uint32Array(JOIN_CODE_LENGTH));
    return Array.from(bytes, b => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join('');
}

// Creates a game for the quiz with a fresh join code. The host is the
// signed-in user; the owner trigger fills "userId" (see supabase/migrations).
export async function hostGame(quizId: number): Promise<HostedGame> {
    if (!supabase) throw new Error('Supabase is not configured.');

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
        const { data, error } = await supabase
            .from('GameHistory')
            .insert({ quizId, gameCode: generateGameCode() })
            .select('gameId, gameCode')
            .single();
        if (!error) return data;
        if (error.code !== UNIQUE_VIOLATION) throw error;
    }
    throw new Error('Could not create a unique game code. Please try again.');
}
