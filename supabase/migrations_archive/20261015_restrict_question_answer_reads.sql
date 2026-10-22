-- Only a quiz's owner may read its questions and answers.
-- RLS policies are OR-ed together, so adding an owner-only policy does nothing
-- while a broad SELECT policy still exists. The old SELECT policies must go.

alter table public."Question" enable row level security;
alter table public."Answer"   enable row level security;

-- Drops every existing SELECT policy on the two tables
do $$
declare
  p record;
begin
  for p in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('Question', 'Answer')
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$$;

-- Indexes so the owner check
create index if not exists "Question_quizId_idx"   on public."Question" ("quizId");
create index if not exists "Answer_questionId_idx" on public."Answer" ("questionId");

-- Owners can read the questions of their own quizzes. This reuses the
-- is_quiz_owner / is_question_owner helpers that the existing insert, update
-- and delete policies already use, so "owner" is defined in one place. It also
-- covers the INSERT ... RETURNING and DELETE ... WHERE that createQuiz and
-- updateQuiz run.
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
