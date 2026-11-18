-- Gameplay: the host screen shows an answer (Question."questionText") and players
-- bet points on which of its four Answer rows is the question that fits it.
-- Players start with STARTING_POINTS, may buy the question's hints before
-- betting, and a bet pays +wager when correct and -wager when wrong.
--
-- The persistent tables (GameHistory, GamePlayer, Bet, Hint) were made in the
-- dashboard. This migration assumes, from the schema diagram:
--   * GamePlayer has primary key ("gameId", "playerId"), "playerId" is not an
--     identity column, and "finalPoints" may be updated during the game. It
--     holds the player's running total, which is final once the game ends.
--   * Bet has one row per ("gameId", "playerId", "questionId").
-- All game rules run in the functions below, called only by the Edge Functions'
-- admin client with a user id taken from the verified JWT. Each one locks the
-- QuizInstance row, so bets, hint purchases and the reveal cannot interleave.
-- Idempotent.

-- Links a live instance to its permanent GameHistory row, and stores where the
-- game is. "currentQuestion" and "lastReveal" hold the public payloads that are
-- also broadcast, so a reload can read them back from the row.
alter table public."QuizInstance"
  add column if not exists "gameId" integer references public."GameHistory" ("gameId") on delete set null,
  add column if not exists "phase" text not null default 'lobby',
  add column if not exists "questionIndex" integer,
  add column if not exists "questionStartedAt" timestamptz,
  add column if not exists "currentQuestion" jsonb,
  add column if not exists "lastReveal" jsonb;

alter table public."QuizInstance" drop constraint if exists "QuizInstance_phase_check";
alter table public."QuizInstance"
  add constraint "QuizInstance_phase_check"
  check ("phase" in ('lobby', 'question', 'reveal', 'finished'));

-- Which hints each player bought. The primary key stops a hint being charged twice.
create table if not exists public."HintPurchase" (
  "gameId" integer not null,
  "playerId" integer not null,
  "hintId" integer not null references public."Hint" ("hintId") on delete cascade,
  "purchasedAt" timestamptz not null default now(),
  primary key ("gameId", "playerId", "hintId"),
  foreign key ("gameId", "playerId")
    references public."GamePlayer" ("gameId", "playerId") on delete cascade
);

-- Members of a live game may read its players (nicknames and points). Bets and
-- hint purchases are only read through the functions below.
alter table public."GamePlayer" enable row level security;
alter table public."Bet" enable row level security;
alter table public."HintPurchase" enable row level security;

drop policy if exists "Members can read the players in their game" on public."GamePlayer";
create policy "Members can read the players in their game"
  on public."GamePlayer"
  for select
  to authenticated
  using (
    exists (
      select 1
      from public."QuizInstance" qi
      where qi."gameId" = "GamePlayer"."gameId"
        and (
          qi."hostId" = (select auth.uid())
          or (select auth.uid()) = any (qi."attendingPlayers")
        )
    )
  );

-- Players with their points, highest first. With a question id, each entry also
-- carries that question's wager and result (zero for players who did not bet).
create or replace function public.game_standings(p_game_id integer, p_question_id integer default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
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

-- Replaces the two-argument version: joining now also creates the GamePlayer row.
drop function if exists public.join_quiz_instance(text, uuid);
create or replace function public.join_quiz_instance(
  p_join_code text,
  p_player_id uuid,
  p_nickname text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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

-- Moves the game one step: lobby/reveal -> next question (or finished), and
-- question -> reveal, which settles every bet on that question. p_from_phase is
-- the phase the host saw; if the game has already moved on (a double click, or
-- the countdown and a click together) nothing changes and "changed" is false.
create or replace function public.advance_quiz_instance(
  p_instance_id uuid,
  p_host_id uuid,
  p_from_phase text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  instance public."QuizInstance"%rowtype;
  question_id integer;
  question_text text;
  question_count integer;
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
      'correctAnswerId', (
        select a."answerId" from public."Answer" a
        where a."questionId" = question_id and a."isCorrect"
        order by a."answerId"
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
    select count(*) into question_count
    from public."Question" q
    where q."quizId" = instance."quizId";

    if next_index >= question_count then
      instance."phase" := 'finished';
      instance."currentQuestion" := null;
      instance."lastReveal" := coalesce(instance."lastReveal", '{}'::jsonb)
        || jsonb_build_object('standings', public.game_standings(instance."gameId"));
    else
      select q."questionId", q."questionText" into question_id, question_text
      from public."Question" q
      where q."quizId" = instance."quizId"
      order by q."questionId"
      offset next_index
      limit 1;

      instance."phase" := 'question';
      instance."questionIndex" := next_index;
      instance."questionStartedAt" := now();
      instance."currentQuestion" := jsonb_build_object(
        'questionId', question_id,
        'index', next_index,
        'total', question_count,
        'text', question_text,
        'options', coalesce((
          select jsonb_agg(jsonb_build_object('answerId', a."answerId", 'text', a."answerText") order by a."answerId")
          from public."Answer" a
          where a."questionId" = question_id
        ), '[]'::jsonb),
        'hints', coalesce((
          select jsonb_agg(jsonb_build_object('hintId', h."hintId", 'cost', coalesce(h."hintCost", 0)) order by h."hintId")
          from public."Hint" h
          where h."questionId" = question_id
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

-- The caller's private view of the current question: points, the bet they placed
-- and the hints they bought (with text). Never says whether the bet is correct;
-- that comes from the reveal. Null when the caller is not a player in the game.
create or replace function public.player_state(p_instance_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
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
      select jsonb_agg(jsonb_build_object('hintId', h."hintId", 'text', h."hintText", 'cost', h."hintCost") order by h."hintId")
      from public."HintPurchase" hp
      join public."Hint" h on h."hintId" = hp."hintId"
      where hp."gameId" = gp."gameId"
        and hp."playerId" = gp."playerId"
        and h."questionId" = (qi."currentQuestion" ->> 'questionId')::integer
    ), '[]'::jsonb)
  )
  from public."QuizInstance" qi
  join public."GamePlayer" gp on gp."gameId" = qi."gameId" and gp."userId" = p_user_id
  where qi.id = p_instance_id;
$$;

-- Locks the instance and checks the caller may act on the open question.
-- Shared by place_bet and buy_hint; returns the caller's GamePlayer row.
create or replace function public.lock_open_question(p_instance_id uuid, p_user_id uuid)
returns public."GamePlayer"
language plpgsql
security invoker
set search_path = ''
as $$
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

create or replace function public.place_bet(
  p_instance_id uuid,
  p_user_id uuid,
  p_answer_id integer,
  p_wager integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  player public."GamePlayer"%rowtype;
  question_id integer;
  correct boolean;
begin
  player := public.lock_open_question(p_instance_id, p_user_id);

  select (qi."currentQuestion" ->> 'questionId')::integer into question_id
  from public."QuizInstance" qi
  where qi.id = p_instance_id;

  select a."isCorrect" into correct
  from public."Answer" a
  where a."answerId" = p_answer_id and a."questionId" = question_id;

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

-- Hints must be bought before betting: points spent after a bet could otherwise
-- push a losing player below zero.
create or replace function public.buy_hint(
  p_instance_id uuid,
  p_user_id uuid,
  p_hint_id integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  player public."GamePlayer"%rowtype;
  question_id integer;
  cost integer;
begin
  player := public.lock_open_question(p_instance_id, p_user_id);

  select (qi."currentQuestion" ->> 'questionId')::integer into question_id
  from public."QuizInstance" qi
  where qi.id = p_instance_id;

  select coalesce(h."hintCost", 0) into cost
  from public."Hint" h
  where h."hintId" = p_hint_id and h."questionId" = question_id;

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

-- Only the Edge Functions' admin client may call these: each takes a user id that
-- the function reads from the verified JWT.
revoke execute on function public.game_standings(integer, integer) from public, anon, authenticated;
revoke execute on function public.join_quiz_instance(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.advance_quiz_instance(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.player_state(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.lock_open_question(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.place_bet(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke execute on function public.buy_hint(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.game_standings(integer, integer) to service_role;
grant execute on function public.join_quiz_instance(text, uuid, text) to service_role;
grant execute on function public.advance_quiz_instance(uuid, uuid, text) to service_role;
grant execute on function public.player_state(uuid, uuid) to service_role;
grant execute on function public.lock_open_question(uuid, uuid) to service_role;
grant execute on function public.place_bet(uuid, uuid, integer, integer) to service_role;
grant execute on function public.buy_hint(uuid, uuid, integer) to service_role;
