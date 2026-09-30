// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

interface ReqPayload {
  joinCode: string;
}

console.info("server started");

export default {
  fetch: withSupabase({ auth: ["publishable"] }, async (req, ctx) => {
    const { joinCode }: ReqPayload = await req.json();
    if(typeof(joinCode) !== typeof(String)){
      throw Error("Type error: excpected type String in field quizId");
    }

    if (ctx.authMode === "publishable") {
      const { data, error } = await withSupabase
      .from("QuizInstance")
      .textSearch("joinCode", joinCode);

      if (error !== null){
        return Response.json({
          message: `Error fetching data`,
          error: JSON.stringify(error),
        });
      }
      if (data === null){
        return Response.json({
          message: `No quiz has join code ${joinCode}`,
        });
      }

      return Response.json({
        message: "Quizz Joined sucessfully",
        data: data.quizId,
      });
    }
  })
};