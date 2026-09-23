-- ReverseKahoot: Profile creation on sign-up + row level security for all tables.
-- Applied to the live project on 2026-09-23. Idempotent: safe to re-run.
--
-- Access model
--   anon (not signed in)   read quiz content (Category, Quiz, Question, Answer, Hint)
--                          and Profile usernames. No writes at all.
--   authenticated          everything anon can do, plus:
--     Profile              insert/update own row
--     Category             insert own; update/delete own (global rows, userId null, are read-only)
--     Quiz                 insert own; update/delete own
--     Question/Answer/Hint write only when you own the parent quiz
--     GameHistory          host creates; host and players read; host updates/deletes
--     GamePlayer           host adds anyone, a user may add themself; participants read; host edits
--     Bet                  host or the betting player writes; participants read; host deletes
--   Guests joining a game should use Supabase anonymous sign-in so they get an auth.uid().

-- ---------------------------------------------------------------------------
-- 1. Grants. RLS does not cover TRUNCATE, so strip privileges RLS cannot guard.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to anon;
revoke all on all sequences in schema public from anon;

revoke truncate, references, trigger on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public grant select on tables to anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Profile: unique usernames (case-insensitive) and automatic creation.
-- ---------------------------------------------------------------------------
create unique index if not exists "Profile_userName_lower_key"
  on public."Profile" (lower("userName"));

-- Returns base_name if free, otherwise base_name plus a short suffix from the user id.
create or replace function public.unique_user_name(base_name text, uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: give every existing auth user a Profile row.
insert into public."Profile" ("userId", "userName")
select u.id,
       public.unique_user_name(
         coalesce(nullif(trim(u.raw_user_meta_data ->> 'userName'), ''),
                  split_part(coalesce(u.email, 'player'), '@', 1)),
         u.id)
from auth.users u
where not exists (select 1 from public."Profile" p where p."userId" = u.id);

-- ---------------------------------------------------------------------------
-- 3. Ownership helpers. SECURITY DEFINER so policies can look at parent rows
--    without recursing into those tables' own policies.
-- ---------------------------------------------------------------------------
create or replace function public.is_quiz_owner(p_quiz_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public."Quiz" q
    where q."quizId" = p_quiz_id and q."userId" = auth.uid()
  );
$$;

create or replace function public.is_question_owner(p_question_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public."Question" qu
    join public."Quiz" q on q."quizId" = qu."quizId"
    where qu."questionId" = p_question_id and q."userId" = auth.uid()
  );
$$;

create or replace function public.is_game_host(p_game_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public."GameHistory" g
    where g."gameId" = p_game_id and g."userId" = auth.uid()
  );
$$;

create or replace function public.is_game_player(p_game_id integer, p_player_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public."GamePlayer" gp
    where gp."gameId" = p_game_id and gp."playerId" = p_player_id and gp."userId" = auth.uid()
  );
$$;

create or replace function public.is_game_participant(p_game_id integer)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_game_host(p_game_id) or exists (
    select 1 from public."GamePlayer" gp
    where gp."gameId" = p_game_id and gp."userId" = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Policies.
-- ---------------------------------------------------------------------------
alter table public."Profile"     enable row level security;
alter table public."Category"    enable row level security;
alter table public."Quiz"        enable row level security;
alter table public."Question"    enable row level security;
alter table public."Answer"      enable row level security;
alter table public."Hint"        enable row level security;
alter table public."GameHistory" enable row level security;
alter table public."GamePlayer"  enable row level security;
alter table public."Bet"         enable row level security;

-- Profile
drop policy if exists "Profile: anyone can read" on public."Profile";
create policy "Profile: anyone can read" on public."Profile"
  for select to anon, authenticated using (true);

drop policy if exists "Profile: insert own" on public."Profile";
create policy "Profile: insert own" on public."Profile"
  for insert to authenticated with check ("userId" = auth.uid());

drop policy if exists "Profile: update own" on public."Profile";
create policy "Profile: update own" on public."Profile"
  for update to authenticated using ("userId" = auth.uid()) with check ("userId" = auth.uid());

-- Category
drop policy if exists "Category: anyone can read" on public."Category";
create policy "Category: anyone can read" on public."Category"
  for select to anon, authenticated using (true);

drop policy if exists "Category: insert own" on public."Category";
create policy "Category: insert own" on public."Category"
  for insert to authenticated with check ("userId" = auth.uid());

drop policy if exists "Category: update own" on public."Category";
create policy "Category: update own" on public."Category"
  for update to authenticated using ("userId" = auth.uid()) with check ("userId" = auth.uid());

drop policy if exists "Category: delete own" on public."Category";
create policy "Category: delete own" on public."Category"
  for delete to authenticated using ("userId" = auth.uid());

-- Quiz
drop policy if exists "Quiz: anyone can read" on public."Quiz";
create policy "Quiz: anyone can read" on public."Quiz"
  for select to anon, authenticated using (true);

drop policy if exists "Quiz: insert own" on public."Quiz";
create policy "Quiz: insert own" on public."Quiz"
  for insert to authenticated with check ("userId" = auth.uid());

drop policy if exists "Quiz: update own" on public."Quiz";
create policy "Quiz: update own" on public."Quiz"
  for update to authenticated using ("userId" = auth.uid()) with check ("userId" = auth.uid());

drop policy if exists "Quiz: delete own" on public."Quiz";
create policy "Quiz: delete own" on public."Quiz"
  for delete to authenticated using ("userId" = auth.uid());

-- Question
drop policy if exists "Question: anyone can read" on public."Question";
create policy "Question: anyone can read" on public."Question"
  for select to anon, authenticated using (true);

drop policy if exists "Question: quiz owner can insert" on public."Question";
create policy "Question: quiz owner can insert" on public."Question"
  for insert to authenticated with check (public.is_quiz_owner("quizId"));

drop policy if exists "Question: quiz owner can update" on public."Question";
create policy "Question: quiz owner can update" on public."Question"
  for update to authenticated using (public.is_quiz_owner("quizId")) with check (public.is_quiz_owner("quizId"));

drop policy if exists "Question: quiz owner can delete" on public."Question";
create policy "Question: quiz owner can delete" on public."Question"
  for delete to authenticated using (public.is_quiz_owner("quizId"));

-- Answer
drop policy if exists "Answer: anyone can read" on public."Answer";
create policy "Answer: anyone can read" on public."Answer"
  for select to anon, authenticated using (true);

drop policy if exists "Answer: quiz owner can insert" on public."Answer";
create policy "Answer: quiz owner can insert" on public."Answer"
  for insert to authenticated with check (public.is_question_owner("questionId"));

drop policy if exists "Answer: quiz owner can update" on public."Answer";
create policy "Answer: quiz owner can update" on public."Answer"
  for update to authenticated using (public.is_question_owner("questionId")) with check (public.is_question_owner("questionId"));

drop policy if exists "Answer: quiz owner can delete" on public."Answer";
create policy "Answer: quiz owner can delete" on public."Answer"
  for delete to authenticated using (public.is_question_owner("questionId"));

-- Hint
drop policy if exists "Hint: anyone can read" on public."Hint";
create policy "Hint: anyone can read" on public."Hint"
  for select to anon, authenticated using (true);

drop policy if exists "Hint: quiz owner can insert" on public."Hint";
create policy "Hint: quiz owner can insert" on public."Hint"
  for insert to authenticated with check (public.is_question_owner("questionId"));

drop policy if exists "Hint: quiz owner can update" on public."Hint";
create policy "Hint: quiz owner can update" on public."Hint"
  for update to authenticated using (public.is_question_owner("questionId")) with check (public.is_question_owner("questionId"));

drop policy if exists "Hint: quiz owner can delete" on public."Hint";
create policy "Hint: quiz owner can delete" on public."Hint"
  for delete to authenticated using (public.is_question_owner("questionId"));

-- GameHistory
drop policy if exists "GameHistory: participants can read" on public."GameHistory";
create policy "GameHistory: participants can read" on public."GameHistory"
  for select to authenticated using (public.is_game_participant("gameId"));

drop policy if exists "GameHistory: host can insert" on public."GameHistory";
create policy "GameHistory: host can insert" on public."GameHistory"
  for insert to authenticated with check ("userId" = auth.uid());

drop policy if exists "GameHistory: host can update" on public."GameHistory";
create policy "GameHistory: host can update" on public."GameHistory"
  for update to authenticated using ("userId" = auth.uid()) with check ("userId" = auth.uid());

drop policy if exists "GameHistory: host can delete" on public."GameHistory";
create policy "GameHistory: host can delete" on public."GameHistory"
  for delete to authenticated using ("userId" = auth.uid());

-- GamePlayer
drop policy if exists "GamePlayer: participants can read" on public."GamePlayer";
create policy "GamePlayer: participants can read" on public."GamePlayer"
  for select to authenticated using (public.is_game_participant("gameId"));

drop policy if exists "GamePlayer: host adds players or user joins" on public."GamePlayer";
create policy "GamePlayer: host adds players or user joins" on public."GamePlayer"
  for insert to authenticated with check (public.is_game_host("gameId") or "userId" = auth.uid());

drop policy if exists "GamePlayer: host can update" on public."GamePlayer";
create policy "GamePlayer: host can update" on public."GamePlayer"
  for update to authenticated using (public.is_game_host("gameId")) with check (public.is_game_host("gameId"));

drop policy if exists "GamePlayer: host can delete" on public."GamePlayer";
create policy "GamePlayer: host can delete" on public."GamePlayer"
  for delete to authenticated using (public.is_game_host("gameId"));

-- Bet
drop policy if exists "Bet: participants can read" on public."Bet";
create policy "Bet: participants can read" on public."Bet"
  for select to authenticated using (public.is_game_participant("gameId"));

drop policy if exists "Bet: host or player can insert" on public."Bet";
create policy "Bet: host or player can insert" on public."Bet"
  for insert to authenticated
  with check (public.is_game_host("gameId") or public.is_game_player("gameId", "playerId"));

drop policy if exists "Bet: host or player can update" on public."Bet";
create policy "Bet: host or player can update" on public."Bet"
  for update to authenticated
  using (public.is_game_host("gameId") or public.is_game_player("gameId", "playerId"))
  with check (public.is_game_host("gameId") or public.is_game_player("gameId", "playerId"));

drop policy if exists "Bet: host can delete" on public."Bet";
create policy "Bet: host can delete" on public."Bet"
  for delete to authenticated using (public.is_game_host("gameId"));
