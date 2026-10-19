import { supabase } from './client.ts';

// Shared plumbing for calling Supabase Edge Functions. Kept separate from the
// per-feature api files (quiz-instance-api, realtime-api, …) so they all behave
// the same way around sessions, errors and invocation.

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

// Invokes one edge function and throws its real error message on failure.
export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const client = configured();
    const { data, error } = await client.functions.invoke(name, { body });
    if (error) throw new Error(await errorMessage(error));
    return data as T;
}
