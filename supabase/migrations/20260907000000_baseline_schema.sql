-- Baseline: the full schema of the live project as of 2026-10-22, dumped with
-- `supabase db dump`. Replaces the earlier incremental migrations, which only
-- altered tables first created in the dashboard and so could not build a fresh
-- database (kept for reference in supabase/migrations_archive/, which the CLI
-- does not read). New migrations go in later files.
--
-- The dump skips Supabase-managed schemas, so the realtime.messages policy and
-- the sign-up trigger on auth.users are added by hand at the end of this file.




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."advance_quiz_instance"("p_instance_id" "uuid", "p_host_id" "uuid", "p_from_phase" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  instance public."QuizInstance"%rowtype;
  question_id integer;
  question_count integer;
  snap jsonb;
  next_index integer;
begin
  select qi.* into instance
  from public."QuizInstance" qi
  where qi.id = p_instance_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'This game could not be found.';
  end if;
  if instance."hostId" is distinct from p_host_id then
    raise exception using errcode = 'PT403', message = 'Only the host can run this game.';
  end if;
  if not instance."isStarted" then
    raise exception using errcode = 'PT409', message = 'Start the game first.';
  end if;

  if instance."phase" <> p_from_phase or instance."phase" = 'finished' then
    return to_jsonb(instance) || jsonb_build_object('changed', false);
  end if;

  -- The quiz as it was when the game was created: edits to the quiz do not affect it.
  snap := public.instance_snapshot(instance.id);

  if instance."phase" = 'question' then
    question_id := (instance."currentQuestion" ->> 'questionId')::integer;

    update public."Bet" b
    set "pointsWon" = case when b."isCorrect" then b."pointsWagered" else -b."pointsWagered" end
    where b."gameId" = instance."gameId" and b."questionId" = question_id;

    update public."GamePlayer" gp
    set "finalPoints" = gp."finalPoints" + b."pointsWon"
    from public."Bet" b
    where b."gameId" = gp."gameId"
      and b."playerId" = gp."playerId"
      and b."gameId" = instance."gameId"
      and b."questionId" = question_id;

    instance."phase" := 'reveal';
    instance."lastReveal" := jsonb_build_object(
      'questionId', question_id,
      'questionText', (
        select q ->> 'questionText'
        from jsonb_array_elements(snap -> 'questions') q
        where (q ->> 'questionId')::integer = question_id
      ),
      'correctAnswerId', (
        select (a ->> 'answerId')::integer
        from jsonb_array_elements(snap -> 'questions') q
        cross join lateral jsonb_array_elements(q -> 'answers') a
        where (q ->> 'questionId')::integer = question_id
          and coalesce((a ->> 'isCorrect')::boolean, false)
        order by (a ->> 'answerId')::integer
        limit 1
      ),
      'betCounts', coalesce((
        select jsonb_object_agg(counts."answerId", counts.bets)
        from (
          select b."answerId", count(*) as bets
          from public."Bet" b
          where b."gameId" = instance."gameId" and b."questionId" = question_id
          group by b."answerId"
        ) counts
      ), '{}'::jsonb),
      'standings', public.game_standings(instance."gameId", question_id)
    );
  else
    next_index := coalesce(instance."questionIndex", -1) + 1;
    question_count := jsonb_array_length(snap -> 'questions');

    if next_index >= question_count then
      instance."phase" := 'finished';
      instance."currentQuestion" := null;
      instance."lastReveal" := coalesce(instance."lastReveal", '{}'::jsonb)
        || jsonb_build_object('standings', public.game_standings(instance."gameId"));
    else
      question_id := (snap -> 'questions' -> next_index ->> 'questionId')::integer;

      instance."phase" := 'question';
      instance."questionIndex" := next_index;
      instance."questionStartedAt" := now();
      instance."currentQuestion" := jsonb_build_object(
        'questionId', question_id,
        'index', next_index,
        'total', question_count,
        'options', coalesce((
          select jsonb_agg(
            jsonb_build_object('answerId', (a ->> 'answerId')::integer, 'text', a ->> 'answerText')
            order by (a ->> 'answerId')::integer
          )
          from jsonb_array_elements(snap -> 'questions' -> next_index -> 'answers') a
        ), '[]'::jsonb),
        'hints', coalesce((
          select jsonb_agg(
            jsonb_build_object('hintId', (h ->> 'hintId')::integer, 'cost', coalesce((h ->> 'hintCost')::integer, 0))
            order by (h ->> 'hintId')::integer
          )
          from jsonb_array_elements(snap -> 'questions' -> next_index -> 'hints') h
        ), '[]'::jsonb)
      );
    end if;
  end if;

  update public."QuizInstance" qi
  set "phase" = instance."phase",
      "questionIndex" = instance."questionIndex",
      "questionStartedAt" = instance."questionStartedAt",
      "currentQuestion" = instance."currentQuestion",
      "lastReveal" = instance."lastReveal"
  where qi.id = instance.id;

  return to_jsonb(instance) || jsonb_build_object('changed', true);
end;
$$;


ALTER FUNCTION "public"."advance_quiz_instance"("p_instance_id" "uuid", "p_host_id" "uuid", "p_from_phase" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buy_hint"("p_instance_id" "uuid", "p_user_id" "uuid", "p_hint_id" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  player public."GamePlayer"%rowtype;
  question_id integer;
  cost integer;
begin
  player := public.lock_open_question(p_instance_id, p_user_id);

  select (qi."currentQuestion" ->> 'questionId')::integer into question_id
  from public."QuizInstance" qi
  where qi.id = p_instance_id;

  select coalesce((h ->> 'hintCost')::integer, 0) into cost
  from jsonb_array_elements(public.instance_snapshot(p_instance_id) -> 'questions') q
  cross join lateral jsonb_array_elements(q -> 'hints') h
  where (q ->> 'questionId')::integer = question_id
    and (h ->> 'hintId')::integer = p_hint_id;

  if not found then
    raise exception using errcode = 'PT400', message = 'That hint is not part of this question.';
  end if;
  if exists (
    select 1 from public."Bet" b
    where b."gameId" = player."gameId" and b."playerId" = player."playerId" and b."questionId" = question_id
  ) then
    raise exception using errcode = 'PT409', message = 'Hints must be bought before you bet.';
  end if;

  -- Buying the same hint again is a no-op rather than a second charge.
  if not exists (
    select 1 from public."HintPurchase" hp
    where hp."gameId" = player."gameId" and hp."playerId" = player."playerId" and hp."hintId" = p_hint_id
  ) then
    if cost > player."finalPoints" then
      raise exception using errcode = 'PT400', message = 'You do not have enough points for that hint.';
    end if;

    insert into public."HintPurchase" ("gameId", "playerId", "hintId")
    values (player."gameId", player."playerId", p_hint_id);

    update public."GamePlayer" gp
    set "finalPoints" = gp."finalPoints" - cost
    where gp."gameId" = player."gameId" and gp."playerId" = player."playerId";
  end if;

  return public.player_state(p_instance_id, p_user_id);
end;
$$;


ALTER FUNCTION "public"."buy_hint"("p_instance_id" "uuid", "p_user_id" "uuid", "p_hint_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_bet_count"("p_instance_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select count(b.*)::integer
  from public."QuizInstance" qi
  join public."Bet" b
    on b."gameId" = qi."gameId"
   and b."questionId" = (qi."currentQuestion" ->> 'questionId')::integer
  where qi.id = p_instance_id
    and qi."phase" = 'question'
    and (qi."hostId" = auth.uid() or auth.uid() = any (qi."attendingPlayers"));
$$;


ALTER FUNCTION "public"."current_bet_count"("p_instance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."game_standings"("p_game_id" integer, "p_question_id" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId', gp."userId",
        'nickname', gp."playerName",
        'points', gp."finalPoints",
        'wager', coalesce(b."pointsWagered", 0),
        'pointsWon', coalesce(b."pointsWon", 0)
      )
      order by gp."finalPoints" desc, gp."playerId"
    ),
    '[]'::jsonb
  )
  from public."GamePlayer" gp
  left join public."Bet" b
    on b."gameId" = gp."gameId"
   and b."playerId" = gp."playerId"
   and b."questionId" = p_question_id
  where gp."gameId" = p_game_id;
$$;


ALTER FUNCTION "public"."game_standings"("p_game_id" integer, "p_question_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  chosen_name text := nullif(trim(new.raw_user_meta_data ->> 'userName'), '');
begin
  if chosen_name is null then
    chosen_name := split_part(coalesce(new.email, 'player'), '@', 1);
  end if;

  insert into public."Profile" ("userId", "userName")
  values (new.id, public.unique_user_name(chosen_name, new.id))
  on conflict ("userId") do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."instance_snapshot"("p_instance_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  v_game_id integer;
  snap jsonb;
begin
  select qi."gameId" into v_game_id
  from public."QuizInstance" qi
  where qi.id = p_instance_id;

  if v_game_id is null then
    return null;
  end if;

  select s."snapshot" into snap
  from public."GameSnapshot" s
  where s."gameId" = v_game_id;

  -- Games created before snapshots existed get one now (callers hold the instance
  -- row lock, so this cannot race).
  if snap is null then
    insert into public."GameSnapshot" ("gameId", "snapshot")
    select g."gameId", public.snapshot_quiz(g."quizId")
    from public."GameHistory" g
    where g."gameId" = v_game_id and g."quizId" is not null
    on conflict ("gameId") do nothing;

    select s."snapshot" into snap
    from public."GameSnapshot" s
    where s."gameId" = v_game_id;
  end if;

  return snap;
end;
$$;


ALTER FUNCTION "public"."instance_snapshot"("p_instance_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_game_host"("p_game_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public."GameHistory" g
    where g."gameId" = p_game_id and g."userId" = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_game_host"("p_game_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_game_participant"("p_game_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_game_host(p_game_id) or exists (
    select 1 from public."GamePlayer" gp
    where gp."gameId" = p_game_id and gp."userId" = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_game_participant"("p_game_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_game_player"("p_game_id" integer, "p_player_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public."GamePlayer" gp
    where gp."gameId" = p_game_id and gp."playerId" = p_player_id and gp."userId" = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_game_player"("p_game_id" integer, "p_player_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_question_owner"("p_question_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public."Question" qu
    join public."Quiz" q on q."quizId" = qu."quizId"
    where qu."questionId" = p_question_id and q."userId" = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_question_owner"("p_question_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_quiz_owner"("p_quiz_id" integer) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public."Quiz" q
    where q."quizId" = p_quiz_id and q."userId" = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_quiz_owner"("p_quiz_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."join_quiz_instance"("p_join_code" "text", "p_player_id" "uuid", "p_nickname" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  starting_points constant integer := 1000;
  nickname_max_length constant integer := 20;
  instance public."QuizInstance"%rowtype;
  nickname text := btrim(coalesce(p_nickname, ''));
  already_joined boolean;
  next_player_id integer;
begin
  if p_player_id is null then
    raise exception using errcode = '22004', message = 'A player identity is required.';
  end if;

  select qi.* into instance
  from public."QuizInstance" qi
  where qi."joinCode" = p_join_code
  for update;

  if not found then
    raise exception using
      errcode = 'PT404',
      message = format('No game has the join code "%s".', p_join_code);
  end if;

  if instance."isStarted" then
    raise exception using errcode = 'PT409', message = 'This game has already started.';
  end if;

  if instance."gameId" is null then
    raise exception using
      errcode = 'PT409',
      message = 'This lobby is from an older version of the game. Ask the host to host it again.';
  end if;

  already_joined := coalesce(p_player_id = any (instance."attendingPlayers"), false);
  if not already_joined then
    if char_length(nickname) = 0 or char_length(nickname) > nickname_max_length then
      raise exception using
        errcode = 'PT400',
        message = format('Nicknames must be 1 to %s characters.', nickname_max_length);
    end if;

    if exists (
      select 1 from public."GamePlayer" gp
      where gp."gameId" = instance."gameId" and lower(gp."playerName") = lower(nickname)
    ) then
      raise exception using errcode = 'PT409', message = 'That nickname is taken in this game.';
    end if;

    select coalesce(max(gp."playerId"), 0) + 1 into next_player_id
    from public."GamePlayer" gp
    where gp."gameId" = instance."gameId";

    insert into public."GamePlayer" ("gameId", "playerId", "userId", "playerName", "startingPoints", "finalPoints")
    values (instance."gameId", next_player_id, p_player_id, nickname, starting_points, starting_points);

    update public."QuizInstance" qi
    set "attendingPlayers" = array_append(coalesce(qi."attendingPlayers", '{}'), p_player_id)
    where qi.id = instance.id
    returning qi.* into instance;
  end if;

  return to_jsonb(instance) || jsonb_build_object(
    'alreadyJoined', already_joined,
    'players', public.game_standings(instance."gameId")
  );
end;
$$;


ALTER FUNCTION "public"."join_quiz_instance"("p_join_code" "text", "p_player_id" "uuid", "p_nickname" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."GamePlayer" (
    "gameId" integer NOT NULL,
    "playerId" integer NOT NULL,
    "userId" "uuid",
    "playerName" character varying(20) NOT NULL,
    "startingPoints" integer DEFAULT 1000 NOT NULL,
    "finalPoints" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."GamePlayer" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_open_question"("p_instance_id" "uuid", "p_user_id" "uuid") RETURNS "public"."GamePlayer"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  -- Matches QUESTION_TIME_LIMIT_SECONDS in src/common/constants/game.ts, plus a
  -- little grace for requests sent just before the countdown ends.
  answer_window constant interval := interval '32 seconds';
  instance public."QuizInstance"%rowtype;
  player public."GamePlayer"%rowtype;
begin
  select qi.* into instance
  from public."QuizInstance" qi
  where qi.id = p_instance_id
  for update;

  if not found then
    raise exception using errcode = 'PT404', message = 'This game could not be found.';
  end if;
  if instance."phase" <> 'question' or now() > instance."questionStartedAt" + answer_window then
    raise exception using errcode = 'PT409', message = 'Betting is closed for this question.';
  end if;

  select gp.* into player
  from public."GamePlayer" gp
  where gp."gameId" = instance."gameId" and gp."userId" = p_user_id;

  if not found then
    raise exception using errcode = 'PT403', message = 'You are not a player in this game.';
  end if;
  return player;
end;
$$;


ALTER FUNCTION "public"."lock_open_question"("p_instance_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_bet"("p_instance_id" "uuid", "p_user_id" "uuid", "p_answer_id" integer, "p_wager" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  player public."GamePlayer"%rowtype;
  question_id integer;
  correct boolean;
begin
  player := public.lock_open_question(p_instance_id, p_user_id);

  select (qi."currentQuestion" ->> 'questionId')::integer into question_id
  from public."QuizInstance" qi
  where qi.id = p_instance_id;

  select coalesce((a ->> 'isCorrect')::boolean, false) into correct
  from jsonb_array_elements(public.instance_snapshot(p_instance_id) -> 'questions') q
  cross join lateral jsonb_array_elements(q -> 'answers') a
  where (q ->> 'questionId')::integer = question_id
    and (a ->> 'answerId')::integer = p_answer_id;

  if not found then
    raise exception using errcode = 'PT400', message = 'That option is not part of this question.';
  end if;
  if p_wager is null or p_wager < 0 or p_wager > player."finalPoints" then
    raise exception using
      errcode = 'PT400',
      message = format('Bet between 0 and your %s points.', player."finalPoints");
  end if;
  if exists (
    select 1 from public."Bet" b
    where b."gameId" = player."gameId" and b."playerId" = player."playerId" and b."questionId" = question_id
  ) then
    raise exception using errcode = 'PT409', message = 'You already placed a bet on this question.';
  end if;

  insert into public."Bet" ("gameId", "playerId", "questionId", "answerId", "pointsWagered", "pointsWon", "isCorrect")
  values (player."gameId", player."playerId", question_id, p_answer_id, p_wager, 0, coalesce(correct, false));

  return public.player_state(p_instance_id, p_user_id) || jsonb_build_object(
    'betCount', (
      select count(*) from public."Bet" b
      where b."gameId" = player."gameId" and b."questionId" = question_id
    )
  );
end;
$$;


ALTER FUNCTION "public"."place_bet"("p_instance_id" "uuid", "p_user_id" "uuid", "p_answer_id" integer, "p_wager" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."player_state"("p_instance_id" "uuid", "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'nickname', gp."playerName",
    'points', gp."finalPoints",
    'bet', (
      select jsonb_build_object('answerId', b."answerId", 'wager', b."pointsWagered")
      from public."Bet" b
      where b."gameId" = gp."gameId"
        and b."playerId" = gp."playerId"
        and b."questionId" = (qi."currentQuestion" ->> 'questionId')::integer
    ),
    'hints', coalesce((
      select jsonb_agg(
        jsonb_build_object('hintId', (h ->> 'hintId')::integer, 'text', h ->> 'hintText', 'cost', (h ->> 'hintCost')::integer)
        order by (h ->> 'hintId')::integer
      )
      from public."GameSnapshot" s
      cross join lateral jsonb_array_elements(s."snapshot" -> 'questions') q
      cross join lateral jsonb_array_elements(q -> 'hints') h
      where s."gameId" = gp."gameId"
        and (q ->> 'questionId')::integer = (qi."currentQuestion" ->> 'questionId')::integer
        and exists (
          select 1 from public."HintPurchase" hp
          where hp."gameId" = gp."gameId"
            and hp."playerId" = gp."playerId"
            and hp."hintId" = (h ->> 'hintId')::integer
        )
    ), '[]'::jsonb)
  )
  from public."QuizInstance" qi
  join public."GamePlayer" gp on gp."gameId" = qi."gameId" and gp."userId" = p_user_id
  where qi.id = p_instance_id;
$$;


ALTER FUNCTION "public"."player_state"("p_instance_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_quiz"("p_quiz_id" integer, "p_title" "text", "p_category_id" integer, "p_questions" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  max_questions constant integer := 50;
  min_answers constant integer := 2;
  max_answers constant integer := 4;
  max_hints constant integer := 3;
  max_hint_cost constant integer := 500;
  max_title_length constant integer := 100;
  max_text_length constant integer := 500;

  uid uuid := auth.uid();
  title text := btrim(coalesce(p_title, ''));
  v_quiz_id integer := p_quiz_id;
  owner_id uuid;
  q jsonb;
  a jsonb;
  h jsonb;
  q_text text;
  q_id integer;
  a_id integer;
  h_id integer;
  a_text text;
  h_text text;
  h_cost integer;
  answer_texts text[];
  correct_count integer;
  keep_questions integer[] := '{}';
  keep_answers integer[] := '{}';
  keep_hints integer[] := '{}';
  removed integer[];
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = 'PT401', message = 'Sign in with an account to create quizzes.';
  end if;

  if char_length(title) = 0 or char_length(title) > max_title_length then
    raise exception using errcode = 'PT400', message = format('The quiz title must be 1 to %s characters.', max_title_length);
  end if;
  if not exists (select 1 from public."Category" c where c."categoryId" = p_category_id) then
    raise exception using errcode = 'PT400', message = 'Pick a category.';
  end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array'
     or jsonb_array_length(p_questions) < 1 or jsonb_array_length(p_questions) > max_questions then
    raise exception using errcode = 'PT400', message = format('A quiz needs 1 to %s questions.', max_questions);
  end if;

  -- Lock the quiz and check who owns it.
  if v_quiz_id is not null then
    select qz."userId" into owner_id
    from public."Quiz" qz
    where qz."quizId" = v_quiz_id
    for update;

    if not found then
      raise exception using errcode = 'PT404', message = 'This quiz could not be found.';
    end if;
    if owner_id is distinct from uid then
      raise exception using errcode = 'PT403', message = 'You can only edit your own quizzes.';
    end if;

  end if;

  -- Validate everything before writing anything.
  for q in select * from jsonb_array_elements(p_questions) loop
    q_text := btrim(coalesce(q ->> 'questionText', ''));
    if char_length(q_text) = 0 or char_length(q_text) > max_text_length then
      raise exception using errcode = 'PT400', message = format('Every question needs text (up to %s characters).', max_text_length);
    end if;

    if jsonb_typeof(q -> 'answers') <> 'array'
       or jsonb_array_length(q -> 'answers') < min_answers
       or jsonb_array_length(q -> 'answers') > max_answers then
      raise exception using errcode = 'PT400', message = format('"%s" needs %s to %s answers.', left(q_text, 40), min_answers, max_answers);
    end if;

    answer_texts := '{}';
    correct_count := 0;
    for a in select * from jsonb_array_elements(q -> 'answers') loop
      a_text := btrim(coalesce(a ->> 'answerText', ''));
      if char_length(a_text) = 0 or char_length(a_text) > max_text_length then
        raise exception using errcode = 'PT400', message = format('Every answer of "%s" needs text (up to %s characters).', left(q_text, 40), max_text_length);
      end if;
      if lower(a_text) = any (answer_texts) then
        raise exception using errcode = 'PT400', message = format('"%s" has two identical answers.', left(q_text, 40));
      end if;
      answer_texts := answer_texts || lower(a_text);
      if coalesce((a ->> 'isCorrect')::boolean, false) then
        correct_count := correct_count + 1;
      end if;
    end loop;
    if correct_count <> 1 then
      raise exception using errcode = 'PT400', message = format('"%s" needs exactly one correct answer.', left(q_text, 40));
    end if;

    if q ? 'hints' and jsonb_typeof(q -> 'hints') = 'array' then
      if jsonb_array_length(q -> 'hints') > max_hints then
        raise exception using errcode = 'PT400', message = format('"%s" has more than %s hints.', left(q_text, 40), max_hints);
      end if;
      for h in select * from jsonb_array_elements(q -> 'hints') loop
        h_text := btrim(coalesce(h ->> 'hintText', ''));
        h_cost := (h ->> 'hintCost')::integer;
        if char_length(h_text) = 0 or char_length(h_text) > max_text_length then
          raise exception using errcode = 'PT400', message = format('Every hint of "%s" needs text (up to %s characters).', left(q_text, 40), max_text_length);
        end if;
        if h_cost is null or h_cost < 1 or h_cost > max_hint_cost then
          raise exception using errcode = 'PT400', message = format('Hint prices must be between 1 and %s points.', max_hint_cost);
        end if;
      end loop;
    end if;
  end loop;

  -- The quiz row.
  if v_quiz_id is null then
    insert into public."Quiz" ("quizTitle", "categoryId", "userId")
    values (title, p_category_id, uid)
    returning "quizId" into v_quiz_id;
  else
    update public."Quiz" qz
    set "quizTitle" = title, "categoryId" = p_category_id
    where qz."quizId" = v_quiz_id;
  end if;

  -- Questions, answers and hints: update rows that carry an id, insert the rest.
  for q in select * from jsonb_array_elements(p_questions) loop
    q_text := btrim(q ->> 'questionText');
    q_id := (q ->> 'questionId')::integer;

    if q_id is null then
      insert into public."Question" ("quizId", "questionText")
      values (v_quiz_id, q_text)
      returning "questionId" into q_id;
    else
      update public."Question" qq
      set "questionText" = q_text
      where qq."questionId" = q_id and qq."quizId" = v_quiz_id;
      if not found then
        raise exception using errcode = 'PT400', message = 'A question in this save does not belong to the quiz. Reload and try again.';
      end if;
    end if;
    keep_questions := keep_questions || q_id;

    for a in select * from jsonb_array_elements(q -> 'answers') loop
      a_id := (a ->> 'answerId')::integer;
      if a_id is null then
        insert into public."Answer" ("questionId", "answerText", "isCorrect")
        values (q_id, btrim(a ->> 'answerText'), coalesce((a ->> 'isCorrect')::boolean, false))
        returning "answerId" into a_id;
      else
        update public."Answer" aa
        set "answerText" = btrim(a ->> 'answerText'),
            "isCorrect" = coalesce((a ->> 'isCorrect')::boolean, false)
        where aa."answerId" = a_id and aa."questionId" = q_id;
        if not found then
          raise exception using errcode = 'PT400', message = 'An answer in this save does not belong to its question. Reload and try again.';
        end if;
      end if;
      keep_answers := keep_answers || a_id;
    end loop;

    if q ? 'hints' and jsonb_typeof(q -> 'hints') = 'array' then
      for h in select * from jsonb_array_elements(q -> 'hints') loop
        h_id := (h ->> 'hintId')::integer;
        if h_id is null then
          insert into public."Hint" ("questionId", "hintText", "hintCost")
          values (q_id, btrim(h ->> 'hintText'), (h ->> 'hintCost')::integer)
          returning "hintId" into h_id;
        else
          update public."Hint" hh
          set "hintText" = btrim(h ->> 'hintText'), "hintCost" = (h ->> 'hintCost')::integer
          where hh."hintId" = h_id and hh."questionId" = q_id;
          if not found then
            raise exception using errcode = 'PT400', message = 'A hint in this save does not belong to its question. Reload and try again.';
          end if;
        end if;
        keep_hints := keep_hints || h_id;
      end loop;
    end if;
  end loop;

  -- Remove what the author deleted. Bet and HintPurchase rows keep their plain ids
  -- (no foreign keys, see above), and games play from their snapshot, so nothing
  -- else depends on these rows.
  select coalesce(array_agg(aa."answerId"), '{}') into removed
  from public."Answer" aa
  join public."Question" qq on qq."questionId" = aa."questionId"
  where qq."quizId" = v_quiz_id and aa."answerId" <> all (keep_answers);
  delete from public."Answer" aa where aa."answerId" = any (removed);

  select coalesce(array_agg(hh."hintId"), '{}') into removed
  from public."Hint" hh
  join public."Question" qq on qq."questionId" = hh."questionId"
  where qq."quizId" = v_quiz_id and hh."hintId" <> all (keep_hints);
  delete from public."Hint" hh where hh."hintId" = any (removed);

  -- The answers and hints of removed questions were deleted above (those queries
  -- cover the whole quiz), so the questions themselves can go now.
  select coalesce(array_agg(qq."questionId"), '{}') into removed
  from public."Question" qq
  where qq."quizId" = v_quiz_id and qq."questionId" <> all (keep_questions);
  delete from public."Question" qq where qq."questionId" = any (removed);

  return v_quiz_id;
end;
$$;


ALTER FUNCTION "public"."save_quiz"("p_quiz_id" integer, "p_title" "text", "p_category_id" integer, "p_questions" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_owner_from_session"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if auth.uid() is not null then
    new."userId" := auth.uid();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_owner_from_session"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."snapshot_quiz"("p_quiz_id" integer) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'quizId', qz."quizId",
    'quizTitle', qz."quizTitle",
    'questions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'questionId', q."questionId",
          'questionText', q."questionText",
          'answers', coalesce((
            select jsonb_agg(
              jsonb_build_object('answerId', a."answerId", 'answerText', a."answerText", 'isCorrect', a."isCorrect")
              order by a."answerId"
            )
            from public."Answer" a
            where a."questionId" = q."questionId"
          ), '[]'::jsonb),
          'hints', coalesce((
            select jsonb_agg(
              jsonb_build_object('hintId', h."hintId", 'hintText', h."hintText", 'hintCost', coalesce(h."hintCost", 0))
              order by h."hintId"
            )
            from public."Hint" h
            where h."questionId" = q."questionId"
          ), '[]'::jsonb)
        )
        order by q."questionId"
      )
      from public."Question" q
      where q."quizId" = qz."quizId"
    ), '[]'::jsonb)
  )
  from public."Quiz" qz
  where qz."quizId" = p_quiz_id;
$$;


ALTER FUNCTION "public"."snapshot_quiz"("p_quiz_id" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unique_user_name"("base_name" "text", "uid" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  candidate text := left(base_name, 24);
  suffix text := replace(uid::text, '-', '');
begin
  if not exists (select 1 from public."Profile" where lower("userName") = lower(candidate)) then
    return candidate;
  end if;
  candidate := left(base_name, 19) || '_' || left(suffix, 4);
  if not exists (select 1 from public."Profile" where lower("userName") = lower(candidate)) then
    return candidate;
  end if;
  return left(base_name, 15) || '_' || left(suffix, 8);
end;
$$;


ALTER FUNCTION "public"."unique_user_name"("base_name" "text", "uid" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Answer" (
    "answerId" integer NOT NULL,
    "questionId" integer NOT NULL,
    "answerText" "text" NOT NULL,
    "isCorrect" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."Answer" OWNER TO "postgres";


ALTER TABLE "public"."Answer" ALTER COLUMN "answerId" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."Answer_answerId_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."Bet" (
    "gameId" integer NOT NULL,
    "playerId" integer NOT NULL,
    "questionId" integer NOT NULL,
    "answerId" integer NOT NULL,
    "pointsWagered" integer NOT NULL,
    "pointsWon" integer DEFAULT 0 NOT NULL,
    "isCorrect" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."Bet" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Category" (
    "categoryId" integer NOT NULL,
    "categoryName" character varying(25) NOT NULL,
    "userId" "uuid" DEFAULT "auth"."uid"()
);


ALTER TABLE "public"."Category" OWNER TO "postgres";


ALTER TABLE "public"."Category" ALTER COLUMN "categoryId" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."Category_categoryId_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."GameHistory" (
    "gameId" integer NOT NULL,
    "userId" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "quizId" integer,
    "playedAt" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gameCode" character varying(6)
);


ALTER TABLE "public"."GameHistory" OWNER TO "postgres";


ALTER TABLE "public"."GameHistory" ALTER COLUMN "gameId" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."GameHistory_gameId_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."GameSnapshot" (
    "gameId" integer NOT NULL,
    "snapshot" "jsonb" NOT NULL,
    "createdAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."GameSnapshot" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Hint" (
    "hintId" integer NOT NULL,
    "questionId" integer NOT NULL,
    "hintText" character varying(25) NOT NULL,
    "hintCost" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."Hint" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."HintPurchase" (
    "gameId" integer NOT NULL,
    "playerId" integer NOT NULL,
    "hintId" integer NOT NULL,
    "purchasedAt" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."HintPurchase" OWNER TO "postgres";


ALTER TABLE "public"."Hint" ALTER COLUMN "hintId" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."Hint_hintId_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."Profile" (
    "userId" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "userName" character varying(20) NOT NULL
);


ALTER TABLE "public"."Profile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."Question" (
    "questionId" integer NOT NULL,
    "quizId" integer NOT NULL,
    "questionText" character varying(200) NOT NULL
);


ALTER TABLE "public"."Question" OWNER TO "postgres";


ALTER TABLE "public"."Question" ALTER COLUMN "questionId" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."Question_questionId_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."Quiz" (
    "quizId" integer NOT NULL,
    "userId" "uuid" DEFAULT "auth"."uid"(),
    "categoryId" integer NOT NULL,
    "quizTitle" character varying(50) NOT NULL
);


ALTER TABLE "public"."Quiz" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."QuizInstance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quizId" integer,
    "attendingPlayers" "uuid"[],
    "joinCode" character varying NOT NULL,
    "createdAt" timestamp without time zone DEFAULT "now"(),
    "hostId" "uuid" DEFAULT "auth"."uid"(),
    "isStarted" boolean DEFAULT false NOT NULL,
    "gameId" integer,
    "phase" "text" DEFAULT 'lobby'::"text" NOT NULL,
    "questionIndex" integer,
    "questionStartedAt" timestamp with time zone,
    "currentQuestion" "jsonb",
    "lastReveal" "jsonb",
    CONSTRAINT "QuizInstance_phase_check" CHECK (("phase" = ANY (ARRAY['lobby'::"text", 'question'::"text", 'reveal'::"text", 'finished'::"text"])))
);


ALTER TABLE "public"."QuizInstance" OWNER TO "postgres";


COMMENT ON TABLE "public"."QuizInstance" IS 'Instance of a quiz to be played';



ALTER TABLE "public"."Quiz" ALTER COLUMN "quizId" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."Quiz_quizId_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."Answer"
    ADD CONSTRAINT "Answer_pkey" PRIMARY KEY ("answerId");



ALTER TABLE ONLY "public"."Answer"
    ADD CONSTRAINT "Answer_questionId_answerId_key" UNIQUE ("questionId", "answerId");



ALTER TABLE ONLY "public"."Bet"
    ADD CONSTRAINT "Bet_pkey" PRIMARY KEY ("gameId", "playerId", "questionId");



ALTER TABLE ONLY "public"."Category"
    ADD CONSTRAINT "Category_pkey" PRIMARY KEY ("categoryId");



ALTER TABLE ONLY "public"."GameHistory"
    ADD CONSTRAINT "GameHistory_gameCode_key" UNIQUE ("gameCode");



ALTER TABLE ONLY "public"."GameHistory"
    ADD CONSTRAINT "GameHistory_pkey" PRIMARY KEY ("gameId");



ALTER TABLE ONLY "public"."GamePlayer"
    ADD CONSTRAINT "GamePlayer_pkey" PRIMARY KEY ("gameId", "playerId");



ALTER TABLE ONLY "public"."GameSnapshot"
    ADD CONSTRAINT "GameSnapshot_pkey" PRIMARY KEY ("gameId");



ALTER TABLE ONLY "public"."HintPurchase"
    ADD CONSTRAINT "HintPurchase_pkey" PRIMARY KEY ("gameId", "playerId", "hintId");



ALTER TABLE ONLY "public"."Hint"
    ADD CONSTRAINT "Hint_pkey" PRIMARY KEY ("hintId");



ALTER TABLE ONLY "public"."Profile"
    ADD CONSTRAINT "Profile_pkey" PRIMARY KEY ("userId");



ALTER TABLE ONLY "public"."Profile"
    ADD CONSTRAINT "Profile_userName_key" UNIQUE ("userName");



ALTER TABLE ONLY "public"."Question"
    ADD CONSTRAINT "Question_pkey" PRIMARY KEY ("questionId");



ALTER TABLE ONLY "public"."QuizInstance"
    ADD CONSTRAINT "QuizInstance_joinCode_key" UNIQUE ("joinCode");



ALTER TABLE ONLY "public"."QuizInstance"
    ADD CONSTRAINT "QuizInstance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Quiz"
    ADD CONSTRAINT "Quiz_pkey" PRIMARY KEY ("quizId");



CREATE INDEX "Answer_questionId_idx" ON "public"."Answer" USING "btree" ("questionId");



CREATE INDEX "Bet_answerId_idx" ON "public"."Bet" USING "btree" ("answerId");



CREATE INDEX "Bet_questionId_idx" ON "public"."Bet" USING "btree" ("questionId");



CREATE INDEX "Category_userId_idx" ON "public"."Category" USING "btree" ("userId");



CREATE INDEX "GameHistory_quizId_idx" ON "public"."GameHistory" USING "btree" ("quizId");



CREATE INDEX "GameHistory_userId_idx" ON "public"."GameHistory" USING "btree" ("userId");



CREATE INDEX "GamePlayer_userId_idx" ON "public"."GamePlayer" USING "btree" ("userId");



CREATE INDEX "HintPurchase_hintId_idx" ON "public"."HintPurchase" USING "btree" ("hintId");



CREATE INDEX "Hint_questionId_idx" ON "public"."Hint" USING "btree" ("questionId");



CREATE UNIQUE INDEX "Profile_userName_lower_key" ON "public"."Profile" USING "btree" ("lower"(("userName")::"text"));



CREATE INDEX "Question_quizId_idx" ON "public"."Question" USING "btree" ("quizId");



CREATE INDEX "QuizInstance_createdAt_idx" ON "public"."QuizInstance" USING "btree" ("createdAt");



CREATE INDEX "Quiz_categoryId_idx" ON "public"."Quiz" USING "btree" ("categoryId");



CREATE INDEX "Quiz_userId_idx" ON "public"."Quiz" USING "btree" ("userId");



CREATE OR REPLACE TRIGGER "set_owner" BEFORE INSERT ON "public"."Category" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_from_session"();



CREATE OR REPLACE TRIGGER "set_owner" BEFORE INSERT ON "public"."GameHistory" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_from_session"();



CREATE OR REPLACE TRIGGER "set_owner" BEFORE INSERT ON "public"."Profile" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_from_session"();



CREATE OR REPLACE TRIGGER "set_owner" BEFORE INSERT ON "public"."Quiz" FOR EACH ROW EXECUTE FUNCTION "public"."set_owner_from_session"();



ALTER TABLE ONLY "public"."Answer"
    ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("questionId") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Bet"
    ADD CONSTRAINT "Bet_gameId_playerId_fkey" FOREIGN KEY ("gameId", "playerId") REFERENCES "public"."GamePlayer"("gameId", "playerId") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Category"
    ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Profile"("userId") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."GameHistory"
    ADD CONSTRAINT "GameHistory_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "public"."Quiz"("quizId") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."GameHistory"
    ADD CONSTRAINT "GameHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Profile"("userId") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."GamePlayer"
    ADD CONSTRAINT "GamePlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."GameHistory"("gameId") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."GamePlayer"
    ADD CONSTRAINT "GamePlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Profile"("userId") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."GameSnapshot"
    ADD CONSTRAINT "GameSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."GameHistory"("gameId") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."HintPurchase"
    ADD CONSTRAINT "HintPurchase_gameId_playerId_fkey" FOREIGN KEY ("gameId", "playerId") REFERENCES "public"."GamePlayer"("gameId", "playerId") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Hint"
    ADD CONSTRAINT "Hint_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "public"."Question"("questionId") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Profile"
    ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Question"
    ADD CONSTRAINT "Question_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "public"."Quiz"("quizId") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."QuizInstance"
    ADD CONSTRAINT "QuizInstance_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "public"."GameHistory"("gameId") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."QuizInstance"
    ADD CONSTRAINT "QuizInstance_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."QuizInstance"
    ADD CONSTRAINT "QuizInstance_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "public"."Quiz"("quizId") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."Quiz"
    ADD CONSTRAINT "Quiz_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("categoryId") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."Quiz"
    ADD CONSTRAINT "Quiz_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Profile"("userId") ON DELETE CASCADE;



ALTER TABLE "public"."Answer" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Answer: quiz owner can delete" ON "public"."Answer" FOR DELETE TO "authenticated" USING ("public"."is_question_owner"("questionId"));



CREATE POLICY "Answer: quiz owner can insert" ON "public"."Answer" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_question_owner"("questionId"));



CREATE POLICY "Answer: quiz owner can read" ON "public"."Answer" FOR SELECT TO "authenticated" USING ("public"."is_question_owner"("questionId"));



CREATE POLICY "Answer: quiz owner can update" ON "public"."Answer" FOR UPDATE TO "authenticated" USING ("public"."is_question_owner"("questionId")) WITH CHECK ("public"."is_question_owner"("questionId"));



ALTER TABLE "public"."Bet" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."Category" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Category: anyone can read" ON "public"."Category" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Category: delete own" ON "public"."Category" FOR DELETE TO "authenticated" USING (("userId" = "auth"."uid"()));



CREATE POLICY "Category: insert own" ON "public"."Category" FOR INSERT TO "authenticated" WITH CHECK ((("userId" = "auth"."uid"()) AND (NOT COALESCE((("auth"."jwt"() ->> 'is_anonymous'::"text"))::boolean, false))));



CREATE POLICY "Category: update own" ON "public"."Category" FOR UPDATE TO "authenticated" USING (("userId" = "auth"."uid"())) WITH CHECK (("userId" = "auth"."uid"()));



ALTER TABLE "public"."GameHistory" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "GameHistory: participants can read" ON "public"."GameHistory" FOR SELECT TO "authenticated" USING ("public"."is_game_participant"("gameId"));



ALTER TABLE "public"."GamePlayer" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "GamePlayer: participants can read" ON "public"."GamePlayer" FOR SELECT TO "authenticated" USING ("public"."is_game_participant"("gameId"));



ALTER TABLE "public"."GameSnapshot" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."Hint" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Hint: quiz owner can delete" ON "public"."Hint" FOR DELETE TO "authenticated" USING ("public"."is_question_owner"("questionId"));



CREATE POLICY "Hint: quiz owner can insert" ON "public"."Hint" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_question_owner"("questionId"));



CREATE POLICY "Hint: quiz owner can read" ON "public"."Hint" FOR SELECT TO "authenticated" USING ("public"."is_question_owner"("questionId"));



CREATE POLICY "Hint: quiz owner can update" ON "public"."Hint" FOR UPDATE TO "authenticated" USING ("public"."is_question_owner"("questionId")) WITH CHECK ("public"."is_question_owner"("questionId"));



ALTER TABLE "public"."HintPurchase" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Hosts can read their own games" ON "public"."GameHistory" FOR SELECT TO "authenticated" USING (("userId" = "auth"."uid"()));



CREATE POLICY "Members can read the players in their game" ON "public"."GamePlayer" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."QuizInstance" "qi"
  WHERE (("qi"."gameId" = "GamePlayer"."gameId") AND (("qi"."hostId" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "auth"."uid"() AS "uid") = ANY ("qi"."attendingPlayers")))))));



CREATE POLICY "Members can read their quiz instance" ON "public"."QuizInstance" FOR SELECT TO "authenticated" USING ((("hostId" = ( SELECT "auth"."uid"() AS "uid")) OR (( SELECT "auth"."uid"() AS "uid") = ANY ("attendingPlayers"))));



ALTER TABLE "public"."Profile" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Profile: anyone can read" ON "public"."Profile" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Profile: insert own" ON "public"."Profile" FOR INSERT TO "authenticated" WITH CHECK (("userId" = "auth"."uid"()));



CREATE POLICY "Profile: update own" ON "public"."Profile" FOR UPDATE TO "authenticated" USING (("userId" = "auth"."uid"())) WITH CHECK (("userId" = "auth"."uid"()));



ALTER TABLE "public"."Question" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Question: quiz owner can delete" ON "public"."Question" FOR DELETE TO "authenticated" USING ("public"."is_quiz_owner"("quizId"));



CREATE POLICY "Question: quiz owner can insert" ON "public"."Question" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_quiz_owner"("quizId"));



CREATE POLICY "Question: quiz owner can read" ON "public"."Question" FOR SELECT TO "authenticated" USING ("public"."is_quiz_owner"("quizId"));



CREATE POLICY "Question: quiz owner can update" ON "public"."Question" FOR UPDATE TO "authenticated" USING ("public"."is_quiz_owner"("quizId")) WITH CHECK ("public"."is_quiz_owner"("quizId"));



ALTER TABLE "public"."Quiz" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Quiz: anyone can read" ON "public"."Quiz" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Quiz: delete own" ON "public"."Quiz" FOR DELETE TO "authenticated" USING (("userId" = "auth"."uid"()));



CREATE POLICY "Quiz: insert own" ON "public"."Quiz" FOR INSERT TO "authenticated" WITH CHECK ((("userId" = "auth"."uid"()) AND (NOT COALESCE((("auth"."jwt"() ->> 'is_anonymous'::"text"))::boolean, false))));



CREATE POLICY "Quiz: update own" ON "public"."Quiz" FOR UPDATE TO "authenticated" USING (("userId" = "auth"."uid"())) WITH CHECK (("userId" = "auth"."uid"()));



ALTER TABLE "public"."QuizInstance" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";









GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

-- A fresh local database grants everything in public to anon and authenticated.
-- The live project is stricter, and the dump only lists what is granted, so
-- clear the defaults first and let the GRANTs below rebuild the live privileges.
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM "anon", "authenticated";
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM "anon", "authenticated";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated";











































































































































































REVOKE ALL ON FUNCTION "public"."advance_quiz_instance"("p_instance_id" "uuid", "p_host_id" "uuid", "p_from_phase" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_quiz_instance"("p_instance_id" "uuid", "p_host_id" "uuid", "p_from_phase" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."buy_hint"("p_instance_id" "uuid", "p_user_id" "uuid", "p_hint_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."buy_hint"("p_instance_id" "uuid", "p_user_id" "uuid", "p_hint_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_bet_count"("p_instance_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_bet_count"("p_instance_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_bet_count"("p_instance_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."game_standings"("p_game_id" integer, "p_question_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."game_standings"("p_game_id" integer, "p_question_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."instance_snapshot"("p_instance_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."instance_snapshot"("p_instance_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_game_host"("p_game_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_game_host"("p_game_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_game_host"("p_game_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_game_participant"("p_game_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_game_participant"("p_game_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_game_participant"("p_game_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_game_player"("p_game_id" integer, "p_player_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_game_player"("p_game_id" integer, "p_player_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_game_player"("p_game_id" integer, "p_player_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_question_owner"("p_question_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_question_owner"("p_question_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_question_owner"("p_question_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_quiz_owner"("p_quiz_id" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."is_quiz_owner"("p_quiz_id" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_quiz_owner"("p_quiz_id" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."join_quiz_instance"("p_join_code" "text", "p_player_id" "uuid", "p_nickname" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."join_quiz_instance"("p_join_code" "text", "p_player_id" "uuid", "p_nickname" "text") TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."GamePlayer" TO "authenticated";
GRANT ALL ON TABLE "public"."GamePlayer" TO "service_role";
GRANT SELECT ON TABLE "public"."GamePlayer" TO "anon";



REVOKE ALL ON FUNCTION "public"."lock_open_question"("p_instance_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lock_open_question"("p_instance_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."place_bet"("p_instance_id" "uuid", "p_user_id" "uuid", "p_answer_id" integer, "p_wager" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_bet"("p_instance_id" "uuid", "p_user_id" "uuid", "p_answer_id" integer, "p_wager" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."player_state"("p_instance_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."player_state"("p_instance_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_quiz"("p_quiz_id" integer, "p_title" "text", "p_category_id" integer, "p_questions" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_quiz"("p_quiz_id" integer, "p_title" "text", "p_category_id" integer, "p_questions" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_quiz"("p_quiz_id" integer, "p_title" "text", "p_category_id" integer, "p_questions" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_owner_from_session"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_owner_from_session"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_owner_from_session"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."snapshot_quiz"("p_quiz_id" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."snapshot_quiz"("p_quiz_id" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."unique_user_name"("base_name" "text", "uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."unique_user_name"("base_name" "text", "uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unique_user_name"("base_name" "text", "uid" "uuid") TO "service_role";
























GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."Answer" TO "authenticated";
GRANT ALL ON TABLE "public"."Answer" TO "service_role";
GRANT SELECT ON TABLE "public"."Answer" TO "anon";



GRANT ALL ON SEQUENCE "public"."Answer_answerId_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."Answer_answerId_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."Bet" TO "authenticated";
GRANT ALL ON TABLE "public"."Bet" TO "service_role";
GRANT SELECT ON TABLE "public"."Bet" TO "anon";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."Category" TO "authenticated";
GRANT ALL ON TABLE "public"."Category" TO "service_role";
GRANT SELECT ON TABLE "public"."Category" TO "anon";



GRANT ALL ON SEQUENCE "public"."Category_categoryId_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."Category_categoryId_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."GameHistory" TO "authenticated";
GRANT ALL ON TABLE "public"."GameHistory" TO "service_role";
GRANT SELECT ON TABLE "public"."GameHistory" TO "anon";



GRANT ALL ON SEQUENCE "public"."GameHistory_gameId_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."GameHistory_gameId_seq" TO "service_role";



GRANT ALL ON TABLE "public"."GameSnapshot" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."Hint" TO "authenticated";
GRANT ALL ON TABLE "public"."Hint" TO "service_role";
GRANT SELECT ON TABLE "public"."Hint" TO "anon";



GRANT SELECT ON TABLE "public"."HintPurchase" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."HintPurchase" TO "authenticated";
GRANT ALL ON TABLE "public"."HintPurchase" TO "service_role";



GRANT ALL ON SEQUENCE "public"."Hint_hintId_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."Hint_hintId_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."Profile" TO "authenticated";
GRANT ALL ON TABLE "public"."Profile" TO "service_role";
GRANT SELECT ON TABLE "public"."Profile" TO "anon";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."Question" TO "authenticated";
GRANT ALL ON TABLE "public"."Question" TO "service_role";
GRANT SELECT ON TABLE "public"."Question" TO "anon";



GRANT ALL ON SEQUENCE "public"."Question_questionId_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."Question_questionId_seq" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."Quiz" TO "authenticated";
GRANT ALL ON TABLE "public"."Quiz" TO "service_role";
GRANT SELECT ON TABLE "public"."Quiz" TO "anon";



GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."QuizInstance" TO "anon";
GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."QuizInstance" TO "authenticated";
GRANT ALL ON TABLE "public"."QuizInstance" TO "service_role";



GRANT ALL ON SEQUENCE "public"."Quiz_quizId_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."Quiz_quizId_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

































-- Not covered by the dump (managed schemas) ----------------------------------

-- Only members of the instance named in the topic may receive broadcasts.
-- Clients subscribe to "quiz-instance:<instance id>"; topic format lives in
-- supabase/functions/_shared/realtime.ts. Compared as text so a non-quiz topic
-- cannot throw an invalid-uuid error.
drop policy if exists "Members can receive on their quiz channel" on realtime.messages;
create policy "Members can receive on their quiz channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public."QuizInstance" qi
      where qi.id::text = split_part((select realtime.topic()), ':', 2)
        and (
          qi."hostId" = (select auth.uid())
          or (select auth.uid()) = any (qi."attendingPlayers")
        )
    )
  );

-- Every new auth user (email or anonymous) gets a Profile row.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
