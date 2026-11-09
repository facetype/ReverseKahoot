import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { broadcast, quizChannel } from "../_shared/realtime.ts";
import { rpcErrorResponse } from "../_shared/rpc.ts";

const PHASES = ["lobby", "question", "reveal"];

interface ReqPayload {
  instanceId: string;
  fromPhase: string;
}

interface AdvanceResult {
  id: string;
  phase: string;
  questionStartedAt: string | null;
  currentQuestion: unknown;
  lastReveal: unknown;
  changed: boolean;
}

// The host moves the game one step: next question, reveal, ..., finished. The
// rules (and the host check) live in advance_quiz_instance in supabase/migrations.
export default {
  fetch: withSupabase({ auth: ["user"] }, async (req, ctx) => {
    let payload: ReqPayload;
    try {
      payload = await req.json();
    } catch {
      return Response.json({ error: "Expected a JSON body." }, { status: 400 });
    }

    const instanceId = typeof payload?.instanceId === "string" ? payload.instanceId.trim() : "";
    const fromPhase = typeof payload?.fromPhase === "string" ? payload.fromPhase : "";
    if (!instanceId || !PHASES.includes(fromPhase)) {
      return Response.json(
        { error: `instanceId and fromPhase (${PHASES.join(", ")}) are required.` },
        { status: 400 },
      );
    }

    const hostId = ctx.userClaims?.id ?? null;
    if (!hostId) {
      return Response.json({ error: "Sign in before running a game." }, { status: 401 });
    }

    const { data, error } = await ctx.supabaseAdmin.rpc("advance_quiz_instance", {
      p_instance_id: instanceId,
      p_host_id: hostId,
      p_from_phase: fromPhase,
    });
    if (error) return rpcErrorResponse(error);

    const row = data as AdvanceResult;
    // Public: the options never say which one is correct until the reveal.
    const state = {
      phase: row.phase,
      questionStartedAt: row.questionStartedAt,
      currentQuestion: row.currentQuestion,
      lastReveal: row.lastReveal,
    };

    if (row.changed) {
      // A failed broadcast must not undo the step; clients also re-read the row.
      try {
        await broadcast(quizChannel(row.id), "game-state", state);
      } catch (broadcastError) {
        console.error("game-state broadcast failed:", broadcastError);
      }
    }

    return Response.json(state);
  }),
};
