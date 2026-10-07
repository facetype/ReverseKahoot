import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { broadcast, quizChannel } from "../_shared/realtime.ts";

function randomAlphanumeric(length: number = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

interface ReqPayload {
  quizId: number;
}

export default {
  fetch: withSupabase(
    // "user" first: an anonymous sign-in still counts as a user. The key modes
    // are kept so internal calls keep working.
    { auth: ["user", "publishable", "secret"] },
    async (req, ctx) => {
      let payload: ReqPayload;
      try {
        payload = await req.json();
      } catch {
        return Response.json({ error: "Expected a JSON body." }, { status: 400 });
      }

      const { quizId } = payload;

      if (!Number.isInteger(quizId)) {
        return Response.json({ error: "quizId must be an integer" }, { status: 400 });
      }

      // The host is the signed-in caller. ctx.supabaseAdmin bypasses RLS; the
      // host id is taken from the verified JWT, never from the request body.
      const hostId = ctx.userClaims?.id ?? null;

      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await ctx.supabaseAdmin
          .from("QuizInstance")
          .insert({
            id: crypto.randomUUID(),
            quizId,
            joinCode: randomAlphanumeric(),
            attendingPlayers: [],
            createdAt: new Date().toISOString(),
            hostId,
            // join() refuses anyone once the host has started the game.
            isStarted: false,
          })
          .select()
          .single();

        if (!error) {
          const channel = quizChannel(data.id);

          // Bring the game's realtime channel into existence by publishing the
          // first event on it. The host and other members subscribe to this
          // private topic. A failed broadcast must not lose the game, so it is
          // logged and the instance is still returned.
          try {
            await broadcast(channel, "game-created", {
              instanceId: data.id,
              quizId: data.quizId,
              joinCode: data.joinCode,
              hostId: data.hostId,
              channel,
            });
          } catch (broadcastError) {
            console.error("game-created broadcast failed:", broadcastError);
          }

          // Key-only callers get only what they need to start a lobby; the
          // host (user) and secret callers get the whole instance row.
          const body =
            ctx.authMode === "publishable"
              ? { instanceId: data.id, joinCode: data.joinCode, channel }
              : { ...data, channel };

          return Response.json(body, { status: 201 });
        }

        // 23505 = unique violation (joinCode already taken) -> retry with a new code
        if (error.code !== "23505") {
          const status = error.code === "23503" ? 404 : 500; // 23503 = quizId doesn't exist
          return Response.json({ error: error.message }, { status });
        }
      }

      return Response.json({ error: "Could not generate a unique join code" }, { status: 500 });
    },
  ),
};
