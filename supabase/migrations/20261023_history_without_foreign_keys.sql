-- History without foreign keys: authors can delete questions, answers and hints
-- freely, even ones used by played or running games. Supersedes the delete guards
-- of 20261021 and 20261022. Idempotent.
--
-- Bet and HintPurchase keep storing questionId / answerId / hintId, but as plain
-- numbers: nothing stops those rows from outliving the quiz rows they name. Games
-- do not need the live rows (they play from QuizInstanceSnapshot), and no query
-- joins Bet or HintPurchase to Question, Answer or Hint.
--
-- Constraint names are looked up instead of assumed, because Bet was created in the
-- dashboard.

do $$
declare
  fk record;
begin
  for fk in
    select c.conrelid::regclass as child, c.conname, c.confrelid::regclass as parent
    from pg_constraint c
    where c.contype = 'f'
      and c.conrelid in ('public."Bet"'::regclass, 'public."HintPurchase"'::regclass)
      and c.confrelid in ('public."Question"'::regclass, 'public."Answer"'::regclass, 'public."Hint"'::regclass)
  loop
    execute format('alter table %s drop constraint %I', fk.child, fk.conname);
    raise notice 'Dropped % on % (referenced %)', fk.conname, fk.child, fk.parent;
  end loop;
end
$$;

-- Lookups by id (and the reverse direction of the old foreign keys) stay fast.
create index if not exists "Bet_questionId_idx" on public."Bet" ("questionId");
create index if not exists "HintPurchase_hintId_idx" on public."HintPurchase" ("hintId");

drop function if exists public.snapshot_uses(integer, text, integer[]);

-- save_quiz creates a quiz (p_quiz_id null) or updates one in place. Editing is
-- allowed while games of the quiz are running: they play from a snapshot. Rows that
-- keep their id; rows missing from the payload are deleted. Everything happens in
-- one transaction, so a failed save changes nothing.
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

-- Let the API see the schema change (embedded selects use foreign keys).
notify pgrst, 'reload schema';
