import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { broadcast, quizChannel } from "../_shared/realtime.ts";

// Sends one payload from a member (host or player) to everyone in a game, on
// its private realtime topic. Clients cannot broadcast on private channels
// themselves — realtime.messages only has a read policy — so member payloads
// are funnelled through here, where membership is verified server-side.

interface ReqPayload {
  instanceId?: string;
  event?: string;
  payload?: Record<string, unknown>;
}

interface QuizInstanceRow {
  id: string;
  hostId: string | null;
  attendingPlayers: string[] | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Letters, digits, dots, underscores and dashes: safe as a realtime event name.
const EVENT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// Broadcasts are fan-out and fire-and-forget; keep them small. JSON strings
// are counted in UTF-16 units here, which matches JSON.stringify exactly.
const MAX_PAYLOAD_CHARS = 32 * 1024;

// Events the server itself owns. A player must not be able to spoof
// "game-started" or the join notifications.
const RESERVED_EVENTS = new Set(["game-created", "player-joined", "game-started"]);

export default {
  fetch: withSupabase({ auth: ["user", "publishable"] }, async (req, ctx) => {
    let body: ReqPayload;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Expected a JSON body." }, { status: 400 });
    }

    const instanceId =
      typeof body?.instanceId === "string" ? body.instanceId.trim() : "";
    if (!UUID_PATTERN.test(instanceId)) {
      return Response.json(
        { error: "instanceId must be the game instance's UUID." },
        { status: 400 },
      );
    }

    const event = typeof body?.event === "string" ? body.event.trim().toLowerCase() : "";
    if (!EVENT_PATTERN.test(event)) {
      return Response.json(
        { error: "event must be 1-64 characters: letters, digits, dots, underscores or dashes." },
        { status: 400 },
      );
    }
    if (RESERVED_EVENTS.has(event)) {
      return Response.json(
        { error: `"${event}" is reserved for the server.` },
        { status: 409 },
      );
    }

    // The payload is forwarded untouched; it only has to be a JSON object.
    const payload = body?.payload;
    if (
      typeof payload !== "object" || payload === null || Array.isArray(payload)
    ) {
      return Response.json({ error: "payload must be a JSON object." }, { status: 400 });
    }
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_PAYLOAD_CHARS) {
      return Response.json(
        { error: `payload must stay under ${MAX_PAYLOAD_CHARS} characters.` },
        { status: 413 },
      );
    }

    // The sender is the signed-in caller; the id comes from the verified JWT.
    const playerId = ctx.userClaims?.id ?? null;
    if (!playerId) {
      return Response.json(
        { error: "Sign in (anonymous is fine) before sending to a game." },
        { status: 401 },
      );
    }

    const { data: instance, error } = await ctx.supabaseAdmin
      .from("QuizInstance")
      .select("id, hostId, attendingPlayers")
      .eq("id", instanceId)
      .maybeSingle<QuizInstanceRow>();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!instance) {
      return Response.json(
        { error: `No game instance with id "${instanceId}".` },
        { status: 404 },
      );
    }

    const isMember =
      instance.hostId === playerId ||
      (instance.attendingPlayers ?? []).includes(playerId);
    if (!isMember) {
      return Response.json(
        { error: "Only members of this game can send payloads to it." },
        { status: 403 },
      );
    }

    const channel = quizChannel(instance.id);

    // Stamp the sender server-side so receivers cannot be spoofed about who
    // the payload came from or when it was sent.
    try {
      await broadcast(channel, event, {
        instanceId: instance.id,
        from: playerId,
        sentAt: new Date().toISOString(),
        payload,
      });
    } catch (broadcastError) {
      console.error(`"${event}" broadcast failed:`, broadcastError);
      return Response.json(
        { error: "Could not deliver the payload. Try again." },
        { status: 502 },
      );
    }

    return Response.json(
      { delivered: true, event, instanceId: instance.id },
      { status: 202 },
    );
  }),
};
