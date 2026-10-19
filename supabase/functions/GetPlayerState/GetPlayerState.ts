import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { rpcErrorResponse } from "../_shared/rpc.ts";

interface ReqPayload {
  instanceId: string;
}

// The caller's private view of the open question: points, their bet and the
// hint texts they bought. Players read it after every game-state change.
export default {
  fetch: withSupabase({ auth: ["user"] }, async (req, ctx) => {
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

    const userId = ctx.userClaims?.id ?? null;
    if (!userId) {
      return Response.json({ error: "Sign in (anonymous is fine) first." }, { status: 401 });
    }

    const { data, error } = await ctx.supabaseAdmin.rpc("player_state", {
      p_instance_id: instanceId,
      p_user_id: userId,
    });
    if (error) return rpcErrorResponse(error);
    if (!data) {
      return Response.json({ error: "You are not a player in this game." }, { status: 403 });
    }

    return Response.json(data);
  }),
};
