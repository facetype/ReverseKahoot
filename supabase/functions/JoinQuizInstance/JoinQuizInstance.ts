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
  createdAt: string;
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

    // Look the game up by its code. ctx.supabaseAdmin bypasses RLS, which the
    // player would not pass for a game they have not joined yet.
    const { data, error } = await ctx.supabaseAdmin
      .from("QuizInstance")
      .select("id, quizId, joinCode, hostId, attendingPlayers, isStarted, createdAt")
      .eq("joinCode", joinCode)
      .maybeSingle<QuizInstanceRow>();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return Response.json({ error: `No game has the join code "${joinCode}".` }, { status: 404 });
    }
    // The lobby closes the moment the host starts the quiz.
    if (data.isStarted) {
      return Response.json({ error: "This game has already started." }, { status: 409 });
    }

    const attending = data.attendingPlayers ?? [];
    const alreadyJoined = attending.includes(playerId);
    const channel = quizChannel(data.id);

    let players = attending;
    if (!alreadyJoined) {
      players = [...attending, playerId];

      const { error: updateError } = await ctx.supabaseAdmin
        .from("QuizInstance")
        .update({ attendingPlayers: players })
        .eq("id", data.id);

      if (updateError) {
        return Response.json({ error: updateError.message }, { status: 500 });
      }

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
