import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { rpcErrorResponse } from "../_shared/rpc.ts";

interface ReqPayload {
  instanceId: string;
  hintId: number;
}

// A player buys one of the open question's hints. The cost comes off their
// points; the rules live in buy_hint in supabase/migrations.
export default {
  fetch: withSupabase({ auth: ["user"] }, async (req, ctx) => {
    let payload: ReqPayload;
    try {
      payload = await req.json();
    } catch {
      return Response.json({ error: "Expected a JSON body." }, { status: 400 });
    }

    const instanceId = typeof payload?.instanceId === "string" ? payload.instanceId.trim() : "";
    const { hintId } = payload ?? {};
    if (!instanceId || !Number.isInteger(hintId)) {
      return Response.json({ error: "instanceId and hintId are required." }, { status: 400 });
    }

    const userId = ctx.userClaims?.id ?? null;
    if (!userId) {
      return Response.json({ error: "Sign in (anonymous is fine) before buying hints." }, { status: 401 });
    }

    const { data, error } = await ctx.supabaseAdmin.rpc("buy_hint", {
      p_instance_id: instanceId,
      p_user_id: userId,
      p_hint_id: hintId,
    });
    if (error) return rpcErrorResponse(error);

    return Response.json(data);
  }),
};
