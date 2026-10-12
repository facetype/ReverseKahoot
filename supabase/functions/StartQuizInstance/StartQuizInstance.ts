import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { broadcast, quizChannel } from "../_shared/realtime.ts";

interface ReqPayload {
  instanceId: string;
}

interface QuizInstanceRow {
  id: string;
  quizId: number;
  hostId: string | null;
  isStarted: boolean | null;
}

export default {
  fetch: withSupabase({ auth: ["user", "publishable"] }, async (req, ctx) => {
    let payload: ReqPayload;
    try {
      payload = await req.json();
    } catch {
      return Response.json({ error: "Expected a JSON body." }, { status: 400 });
    }

    const instanceId = typeof payload?.instanceId === "string" ? payload.instanceId.trim() : "";
    if (!instanceId) {
      return Response.json({ error: "instanceId is required." }, { status: 400 });
    }

    // Only the signed-in host may start the game. The id comes from the verified
    // JWT, never from the request body.
    const hostId = ctx.userClaims?.id ?? null;
    if (!hostId) {
      return Response.json({ error: "Sign in before starting a game." }, { status: 401 });
    }

    // ctx.supabaseAdmin bypasses RLS; the host check below is what authorises.
    const { data, error } = await ctx.supabaseAdmin
      .from("QuizInstance")
      .select("id, quizId, hostId, isStarted")
      .eq("id", instanceId)
      .maybeSingle<QuizInstanceRow>();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return Response.json({ error: `No game instance with id "${instanceId}".` }, { status: 404 });
    }
    if (data.hostId !== hostId) {
      return Response.json({ error: "Only the host can start this game." }, { status: 403 });
    }

    const channel = quizChannel(data.id);

    // Idempotent: starting an already-started game succeeds and re-broadcasts,
    // so a host who reloads can safely ask again.
    if (data.isStarted) {
      return Response.json({
        instanceId: data.id,
        quizId: data.quizId,
        isStarted: true,
        channel,
      });
    }

    const { error: updateError } = await ctx.supabaseAdmin
      .from("QuizInstance")
      .update({ isStarted: true })
      .eq("id", data.id);

    if (updateError) {
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    // Tell players the lobby has closed and the game is starting. A failed
    // broadcast must not undo the start, so it is logged and the start stands.
    try {
      await broadcast(channel, "game-started", {
        instanceId: data.id,
        quizId: data.quizId,
        startedAt: new Date().toISOString(),
      });
    } catch (broadcastError) {
      console.error("game-started broadcast failed:", broadcastError);
    }

    return Response.json({
      instanceId: data.id,
      quizId: data.quizId,
      isStarted: true,
      channel,
    });
  }),
};
