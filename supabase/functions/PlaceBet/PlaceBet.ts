import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { broadcast, quizChannel } from "../_shared/realtime.ts";
import { rpcErrorResponse } from "../_shared/rpc.ts";

interface ReqPayload {
  instanceId: string;
  answerId: number;
  wager: number;
}

// A player bets points on one option of the open question. The rules (window,
// wager limits, one bet per question) live in place_bet in supabase/migrations.
export default {
  fetch: withSupabase({ auth: ["user"] }, async (req, ctx) => {
    let payload: ReqPayload;
    try {
      payload = await req.json();
    } catch {
      return Response.json({ error: "Expected a JSON body." }, { status: 400 });
    }

    const instanceId = typeof payload?.instanceId === "string" ? payload.instanceId.trim() : "";
    const { answerId, wager } = payload ?? {};
    if (!instanceId || !Number.isInteger(answerId) || !Number.isInteger(wager)) {
      return Response.json(
        { error: "instanceId, answerId and a whole-number wager are required." },
        { status: 400 },
      );
    }

    const userId = ctx.userClaims?.id ?? null;
    if (!userId) {
      return Response.json({ error: "Sign in (anonymous is fine) before betting." }, { status: 401 });
    }

    const { data, error } = await ctx.supabaseAdmin.rpc("place_bet", {
      p_instance_id: instanceId,
      p_user_id: userId,
      p_answer_id: answerId,
      p_wager: wager,
    });
    if (error) return rpcErrorResponse(error);

    const { betCount, ...playerState } = data as { betCount: number };

    // Lets the host screen show how many have bet, without saying on what.
    try {
      await broadcast(quizChannel(instanceId), "bet-placed", { betCount });
    } catch (broadcastError) {
      console.error("bet-placed broadcast failed:", broadcastError);
    }

    return Response.json(playerState);
  }),
};
