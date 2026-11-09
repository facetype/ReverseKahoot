-- 1. The question stays hidden until the round ends.
-- 2. Quizzes are saved by one atomic function that updates rows in place.
--

-- Part 1: hidden question ----------------------------------------------------

-- Moves the game one step: lobby/reveal -> next question (or finished), and
-- question -> reveal, which settles every bet on that question. p_from_phase is
-- the phase the host saw; if the game has already moved on (a double click, or
-- the countdown and a click together) nothing changes and "changed" is false.
--
-- The question itself stays hidden while a round is open: "currentQuestion" only
-- carries the answer options and hint prices, and the question text is added to
-- "lastReveal" when the round closes.
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
      'questionText', (
        select q."questionText" from public."Question" q where q."questionId" = question_id
      ),
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
      select q."questionId" into question_id
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

-- Games already in progress still hold the old payload with the question text in
-- it. Remove it so players cannot read it from the QuizInstance row.
update public."QuizInstance"
set "currentQuestion" = "currentQuestion" - 'text'
where "currentQuestion" ? 'text';

-- Hints describe the question, so they get the same protection as Question
alter table public."Hint" enable row level security;

do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'Hint' and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public."Hint"', p.policyname);
  end loop;
end
$$;

create index if not exists "Hint_questionId_idx" on public."Hint" ("questionId");

drop policy if exists "Hint: quiz owner can read" on public."Hint";
create policy "Hint: quiz owner can read"
  on public."Hint"
  for select
  to authenticated
  using (public.is_question_owner("questionId"));

-- Atomic quiz saving --------------------------------------------------
--
-- save_quiz creates a quiz (p_quiz_id null) or updates one in place. Rows that
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
-- accounts may not author quizzes.
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

    -- A running game reads the quiz question by question, so it must not change.
    if exists (
      select 1 from public."QuizInstance" qi
      where qi."quizId" = v_quiz_id and qi."isStarted" and qi."phase" <> 'finished'
    ) then
      raise exception using
        errcode = 'PT409',
        message = 'A game of this quiz is running. Finish it, or wait for it to expire (24 hours), before editing.';
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

  select coalesce(array_agg(aa."answerId"), '{}') into removed
  from public."Answer" aa
  join public."Question" qq on qq."questionId" = aa."questionId"
  where qq."quizId" = v_quiz_id and aa."answerId" <> all (keep_answers);
  if exists (select 1 from public."Bet" b where b."answerId" = any (removed)) then
    raise exception using errcode = 'PT409', message = 'An answer you removed was used in a played game and cannot be deleted. Edit it instead.';
  end if;
  delete from public."Answer" aa where aa."answerId" = any (removed);

  select coalesce(array_agg(hh."hintId"), '{}') into removed
  from public."Hint" hh
  join public."Question" qq on qq."questionId" = hh."questionId"
  where qq."quizId" = v_quiz_id and hh."hintId" <> all (keep_hints);
  if exists (select 1 from public."HintPurchase" hp where hp."hintId" = any (removed)) then
    raise exception using errcode = 'PT409', message = 'A hint you removed was bought in a played game and cannot be deleted. Edit it instead.';
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

revoke execute on function public.save_quiz(integer, text, integer, jsonb) from public, anon;
grant execute on function public.save_quiz(integer, text, integer, jsonb) to authenticated;