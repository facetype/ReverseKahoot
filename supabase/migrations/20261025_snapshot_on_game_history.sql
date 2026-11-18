-- The quiz snapshot belongs to the game, not to the live session. Idempotent.
--
-- Until now the snapshot hung off QuizInstance, which expires after 24 hours and
-- takes the snapshot with it. A played game then kept only bet rows with plain ids.
-- Now the snapshot is stored per GameHistory row (the permanent record), so a game
-- keeps its quiz title, questions, answers and hints for as long as the game exists,
-- whatever happens to the quiz afterwards.
--
-- Deleting a quiz no longer touches games: GameHistory.quizId and
-- QuizInstance.quizId become nullable and are set to null when the quiz is deleted.
-- A running game keeps playing from its snapshot.

-- 1. The snapshot table, keyed by game ------------------------------------------

create table if not exists public."GameSnapshot" (
  "gameId" integer primary key references public."GameHistory" ("gameId") on delete cascade,
  "snapshot" jsonb not null,
  "createdAt" timestamptz not null default now()
);

-- Holds the correct answers, so no client role may touch it (RLS on, no policy).
alter table public."GameSnapshot" enable row level security;
revoke all on public."GameSnapshot" from public, anon, authenticated;
grant select, insert on public."GameSnapshot" to service_role;

-- Carry over the snapshots of games that are still live.
do $$
begin
  if to_regclass('public."QuizInstanceSnapshot"') is not null then
    insert into public."GameSnapshot" ("gameId", "snapshot", "createdAt")
    select qi."gameId", s."snapshot", s."createdAt"
    from public."QuizInstanceSnapshot" s
    join public."QuizInstance" qi on qi.id = s."instanceId"
    where qi."gameId" is not null
    on conflict ("gameId") do nothing;
  end if;
end
$$;

-- 2. The snapshot now also records the quiz's title ------------------------------

create or replace function public.snapshot_quiz(p_quiz_id integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
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

-- 3. The game functions find the snapshot through the instance's game ------------
-- (advance_quiz_instance, place_bet and buy_hint keep calling instance_snapshot.)

create or replace function public.instance_snapshot(p_instance_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
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

revoke execute on function public.snapshot_quiz(integer) from public, anon, authenticated;
revoke execute on function public.instance_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.snapshot_quiz(integer) to service_role;
grant execute on function public.instance_snapshot(uuid) to service_role;

-- The old per-session table is no longer used.
drop function if exists public.snapshot_uses(integer, text, integer[]);
drop table if exists public."QuizInstanceSnapshot";

-- 4. Deleting a quiz leaves its games alone --------------------------------------

alter table public."GameHistory" alter column "quizId" drop not null;
alter table public."GameHistory" drop constraint if exists "GameHistory_quizId_fkey";
alter table public."GameHistory"
  add constraint "GameHistory_quizId_fkey"
  foreign key ("quizId") references public."Quiz" ("quizId") on delete set null;

alter table public."QuizInstance" alter column "quizId" drop not null;
alter table public."QuizInstance" drop constraint if exists "QuizInstance_quizId_fkey";
alter table public."QuizInstance"
  add constraint "QuizInstance_quizId_fkey"
  foreign key ("quizId") references public."Quiz" ("quizId") on delete set null;

notify pgrst, 'reload schema';
