// Realtime broadcast helper for Supabase Edge Functions (Deno).
//
// A "channel" in Supabase Realtime is a topic, not a row: nothing is created on
// the server. The host brings the lobby to life by publishing on the game's
// topic, and players subscribe to it once the join function has added them.
// This helper publishes to a private topic over the Realtime REST API, which
// works from an Edge Function without keeping a WebSocket open.
//
// Only Deno globals and fetch are used, so this runs on Supabase cloud as-is.
// There are deliberately no imports from the frontend project.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Topic prefix for one game. Clients subscribe to the same string.
const QUIZ_CHANNEL_PREFIX = "quiz-instance:";

/** Private topic for one quiz instance: "quiz-instance:<instance id>". */
export function quizChannel(instanceId: string): string {
  return `${QUIZ_CHANNEL_PREFIX}${instanceId}`;
}

/**
 * Publish one event to a private Realtime topic from the server.
 *
 * Resolves on the Realtime 202 Accepted, and throws otherwise so the caller can
 * decide whether that should fail the request or only be logged.
 */
export async function broadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  const url = new URL(`${SUPABASE_URL}/realtime/v1/api/broadcast`);
  url.pathname += `/${encodeURIComponent(topic)}/events/${encodeURIComponent(event)}`;
  url.searchParams.set("private", "true");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (res.status !== 202) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Realtime broadcast "${event}" failed (${res.status}): ${detail}`);
  }
}
