// The game functions in supabase/migrations raise errors with SQLSTATE "PTxxx",
// where xxx is the HTTP status to answer with (PostgREST's own convention).
// Anything else is an unexpected database failure.
export function rpcErrorResponse(error: { code?: string; message: string }): Response {
  const match = /^PT(\d{3})$/.exec(error.code ?? "");
  const status = match ? Number(match[1]) : 500;
  return Response.json({ error: error.message }, { status });
}
