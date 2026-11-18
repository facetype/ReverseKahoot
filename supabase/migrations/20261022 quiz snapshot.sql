-- Games play from a snapshot of the quiz, taken when the game is created, so the
-- quiz can be edited while a game is running without affecting it. Idempotent.
--
-- The snapshot lives in its own table that no client role can read (RLS on, no
-- policy, no grants): it contains the correct answers. Only the Edge Functions'
-- admin client and the functions below touch it.

create table if not exists public."QuizInstanceSnapshot" (
  "instanceId" uuid primary key references public."QuizInstance" (id) on delete cascade,
  "snapshot" jsonb not null,
  "createdAt" timestamptz not null default now()
);

alter table public."QuizInstanceSnapshot" enable row level security;
revoke all on public."QuizInstanceSnapshot" from public, anon, authenticated;
grant select, insert on public."QuizInstanceSnapshot" to service_role;

-- The quiz's questions, answers and hints as one document. Null when the quiz
-- does not exist.
create or replace function public.snapshot_quiz(p_quiz_id integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (select 1 from public."Quiz" qz where qz."quizId" = p_quiz_id) then
      jsonb_build_object('questions', coalesce((
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
        where q."quizId" = p_quiz_id
      ), '[]'::jsonb))
  end;
$$;

-- The snapshot of one game.
create or replace function public.instance_snapshot(p_instance_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  snap jsonb;
begin
  select s."snapshot" into snap
  from public."QuizInstanceSnapshot" s
  where s."instanceId" = p_instance_id;

  if snap is null then
    insert into public."QuizInstanceSnapshot" ("instanceId", "snapshot")
    select qi.id, public.snapshot_quiz(qi."quizId")
    from public."QuizInstance" qi
    where qi.id = p_instance_id
    on conflict ("instanceId") do nothing;

    select s."snapshot" into snap
    from public."QuizInstanceSnapshot" s
    where s."instanceId" = p_instance_id;
  end if;

  return snap;
end;
$$;

-- Whether any unfinished game of the quiz still uses one of these rows
create or replace function public.snapshot_uses(p_quiz_id integer, p_kind text, p_ids integer[])
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public."QuizInstance" qi
    join public."QuizInstanceSnapshot" s on s."instanceId" = qi.id
    cross join lateral jsonb_array_elements(s."snapshot" -> 'questions') q
    where qi."quizId" = p_quiz_id
      and qi."phase" <> 'finished'
      and case p_kind
        when 'question' then (q ->> 'questionId')::integer = any (p_ids)
        when 'answer' then exists (
          select 1 from jsonb_array_elements(q -> 'answers') a where (a ->> 'answerId')::integer = any (p_ids)
        )
        when 'hint' then exists (
          select 1 from jsonb_array_elements(q -> 'hints') h where (h ->> 'hintId')::integer = any (p_ids)
        )
        else false
      end
  );
$$;

-- The game rules now read the snapshot instead of the live quiz tables --------
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

-- The caller's private view of the current question: points, the bet they placed
-- and the hints they bought
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
      from public."QuizInstanceSnapshot" s
      cross join lateral jsonb_array_elements(s."snapshot" -> 'questions') q
      cross join lateral jsonb_array_elements(q -> 'hints') h
      where s."instanceId" = qi.id
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
revoke execute on function public.snapshot_uses(integer, text, integer[]) from public, anon, authenticated;
grant execute on function public.snapshot_quiz(integer) to service_role;
grant execute on function public.instance_snapshot(uuid) to service_role;
grant execute on function public.snapshot_uses(integer, text, integer[]) to service_role;

-- save_quiz: the snapshot replaces the old "no editing while a game runs" rule ----

-- save_quiz creates a quiz (p_quiz_id null) or updates one in place. Editing is
-- allowed while games of the quiz are running: they play from a snapshot. Rows that
-- keep their id keep their history; rows missing from the payload are removed,
-- unless a played game refers to them. Everything happens in one transaction, so a
-- failed save changes nothing.
--
-- p_questions is an array of
--   { "questionId"?: int, "questionText": text,
--     "answers": [ { "answerId"?: int, "answerText": text, "isCorrect": bool } ],
--     "hints":   [ { "hintId"?: int, "hintText": text, "hintCost": int } ] }
--
-- SECURITY DEFINER because it writes Question, Answer and Hint rows whose policies
-- we do not want to depend on; it checks ownership itself. Guest (anonymous)
-- accounts may not author quizzes. The limits below mirror
-- src/common/constants/game.ts.
create or replace function public.save_quiz(
  p_quiz_id integer,
  p_title text,
  p_category_id integer,
  p_questions jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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

  -- Remove what the author deleted. Anything a played game refers to stays: it is
  -- part of that game's history.
  select coalesce(array_agg(qq."questionId"), '{}') into removed
  from public."Question" qq
  where qq."quizId" = v_quiz_id and qq."questionId" <> all (keep_questions);
  if exists (select 1 from public."Bet" b where b."questionId" = any (removed)) then
    raise exception using errcode = 'PT409', message = 'A question you removed was used in a played game and cannot be deleted. Edit it instead.';
  end if;
  if public.snapshot_uses(v_quiz_id, 'question', removed) then
    raise exception using errcode = 'PT409', message = 'A question you removed is part of a game that has not finished yet. Edit it instead, or remove it once that game is over.';
  end if;

  select coalesce(array_agg(aa."answerId"), '{}') into removed
  from public."Answer" aa
  join public."Question" qq on qq."questionId" = aa."questionId"
  where qq."quizId" = v_quiz_id and aa."answerId" <> all (keep_answers);
  if exists (select 1 from public."Bet" b where b."answerId" = any (removed)) then
    raise exception using errcode = 'PT409', message = 'An answer you removed was used in a played game and cannot be deleted. Edit it instead.';
  end if;
  if public.snapshot_uses(v_quiz_id, 'answer', removed) then
    raise exception using errcode = 'PT409', message = 'An answer you removed is part of a game that has not finished yet. Edit it instead, or remove it once that game is over.';
  end if;
  delete from public."Answer" aa where aa."answerId" = any (removed);

  select coalesce(array_agg(hh."hintId"), '{}') into removed
  from public."Hint" hh
  join public."Question" qq on qq."questionId" = hh."questionId"
  where qq."quizId" = v_quiz_id and hh."hintId" <> all (keep_hints);
  if exists (select 1 from public."HintPurchase" hp where hp."hintId" = any (removed)) then
    raise exception using errcode = 'PT409', message = 'A hint you removed was bought in a played game and cannot be deleted. Edit it instead.';
  end if;
  if public.snapshot_uses(v_quiz_id, 'hint', removed) then
    raise exception using errcode = 'PT409', message = 'A hint you removed is part of a game that has not finished yet. Edit it instead, or remove it once that game is over.';
  end if;
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