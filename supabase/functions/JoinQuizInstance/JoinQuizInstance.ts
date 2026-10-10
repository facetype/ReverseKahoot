import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { broadcast, quizChannel } from "../_shared/realtime.ts";

// Matches the client generator (see src/common/constants/game.ts).
const JOIN_CODE_LENGTH = 6;
const JOIN_CODE_PATTERN = /^[A-Z0-9]+$/;

interface ReqPayload {
  joinCode: string;
}

interface QuizInstanceRow {
  id: string;
  quizId: number;
  joinCode: string;
  hostId: string | null;
  attendingPlayers: string[] | null;
  isStarted: boolean | null;
  alreadyJoined: boolean;
}

export default {
  fetch: withSupabase({ auth: ["user", "publishable"] }, async (req, ctx) => {
    let payload: ReqPayload;
    try {
      payload = await req.json();
    } catch {
      return Response.json({ error: "Expected a JSON body." }, { status: 400 });
    }

    const joinCode =
      typeof payload?.joinCode === "string" ? payload.joinCode.trim().toUpperCase() : "";

    if (joinCode.length !== JOIN_CODE_LENGTH || !JOIN_CODE_PATTERN.test(joinCode)) {
      return Response.json(
        { error: `joinCode must be ${JOIN_CODE_LENGTH} letters or digits.` },
        { status: 400 },
      );
    }

    // A player needs an identity so the channel can be limited to members. The
    // app signs players in anonymously before calling this.
    const playerId = ctx.userClaims?.id ?? null;
    if (!playerId) {
      return Response.json(
        { error: "Sign in (anonymous is fine) before joining a game." },
        { status: 401 },
      );
    }

    // The RPC holds a row lock while checking isStarted and adding the player.
    // Concurrent joins cannot overwrite each other, and starting the game takes
    // the same lock. Only the admin client can call this with a verified user id.
    const { data: result, error } = await ctx.supabaseAdmin.rpc("join_quiz_instance", {
      p_join_code: joinCode,
      p_player_id: playerId,
    });

    if (error) {
      const status = error.code === "PT404" ? 404 : error.code === "PT409" ? 409 : 500;
      return Response.json({ error: error.message }, { status });
    }
    if (!result) {
      return Response.json({ error: "Could not join the game." }, { status: 500 });
    }
    const data = result as QuizInstanceRow;
    const players = data.attendingPlayers ?? [];
    const alreadyJoined = data.alreadyJoined;
    const channel = quizChannel(data.id);

    if (!alreadyJoined) {
      // Tell the host and the other players that someone joined the lobby.
      // A failed broadcast must not fail the join itself.
      try {
        await broadcast(channel, "player-joined", {
          instanceId: data.id,
          playerId,
          attendingPlayers: players,
        });
      } catch (broadcastError) {
        console.error("player-joined broadcast failed:", broadcastError);
      }
    }

    return Response.json({
      instanceId: data.id,
      quizId: data.quizId,
      hostId: data.hostId,
      joinCode: data.joinCode,
      isStarted: data.isStarted ?? false,
      attendingPlayers: players,
      channel,
      alreadyJoined,
    });
  }),
};
