import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function randomAlphanumeric(length: number = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

interface ReqPayload {
  quizId: number;
}

async function getHostId(req: Request): Promise<string | null> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user?.id ?? null;
}

export default {
  fetch: withSupabase({ auth: ["publishable", "secret"] }, async (req, ctx) => {
    const { quizId }: ReqPayload = await req.json();

    if (!Number.isInteger(quizId)) {
      return Response.json({ error: "quizId must be an integer" }, { status: 400 });
    }

    const hostId = await getHostId(req);

    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase
        .from("QuizInstance")
        .insert({
          id: crypto.randomUUID(),
          quizId,
          joinCode: randomAlphanumeric(),
          attendingPlayers: [],
          createdAt: new Date().toISOString(),
          hostId,
        })
        .select()
        .single();

      if (!error) {
        return Response.json(
          ctx.authMode === "publishable" ? { joinCode: data.joinCode } : data,
          { status: 201 },
        );
      }

      // 23505 = unique violation (joinCode already taken) → retry with a new code
      if (error.code !== "23505") {
        const status = error.code === "23503" ? 404 : 500; // 23503 = quizId doesn't exist
        return Response.json({ error: error.message }, { status });
      }
    }

    return Response.json({ error: "Could not generate a unique join code" }, { status: 500 });
  }),
};