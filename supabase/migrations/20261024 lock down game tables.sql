-- Lock down the tables that hold game secrets and game scores. Idempotent.
--
-- Found in the schema dump of the live database:
--  * Question and Answer still have the dashboard policy "Enable read access for all
--    users" (using true). Anyone with the publishable key can read every question,
--    answer and isCorrect flag, which defeats the hidden question. 20261015 was meant
--    to remove it and evidently is not in effect.
--  * Bet lets any player insert and update their own rows, and read everyone's
--    (including isCorrect before the reveal). A player could mark their own bet
--    correct or insert a bet with any wager.
--  * GamePlayer lets any signed-in user insert a row for any game with any points.
--
-- All game writes go through the Edge Functions' admin client (service_role, which
-- ignores RLS), and the app only reads QuizInstance and GamePlayer directly, so none
-- of this changes how the game works.

-- 1. Only a quiz's owner may read its questions and answers --------------------

do $$
declare
  p record;
begin
  for p in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('Question', 'Answer')
      and cmd in ('SELECT', 'ALL')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$$;

create policy "Question: quiz owner can read"
  on public."Question"
  for select
  to authenticated
  using (public.is_quiz_owner("quizId"));

create policy "Answer: quiz owner can read"
  on public."Answer"
  for select
  to authenticated
  using (public.is_question_owner("questionId"));

-- 2. Bet: no client access at all (RLS stays on, with no policies) -------------

do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'Bet'
  loop
    execute format('drop policy %I on public."Bet"', p.policyname);
  end loop;
end
$$;

-- 3. GamePlayer and GameHistory: clients may read, never write ------------------

do $$
declare
  p record;
begin
  for p in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('GamePlayer', 'GameHistory')
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$$;

-- 4. Guests (anonymous sign-ins) cannot create quizzes or categories ------------

drop policy if exists "Quiz: insert own" on public."Quiz";
create policy "Quiz: insert own"
  on public."Quiz"
  for insert
  to authenticated
  with check (
    "userId" = auth.uid()
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

drop policy if exists "Category: insert own" on public."Category";
create policy "Category: insert own"
  on public."Category"
  for insert
  to authenticated
  with check (
    "userId" = auth.uid()
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );