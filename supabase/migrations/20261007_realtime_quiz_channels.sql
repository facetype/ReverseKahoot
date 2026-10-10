-- Realtime authorization for the private quiz channels. Clients subscribe to
-- "quiz-instance:<instance id>"; RLS on realtime.messages decides who may join.
-- Access is limited to the host and the players recorded on that instance.
-- Topic format lives in supabase/functions/_shared/realtime.ts. Idempotent.

-- Members (host + joined players) may read their own instance row. This also lets
-- the realtime policy below read it, since RLS applies to that subquery too.
drop policy if exists "Members can read their quiz instance" on public."QuizInstance";
create policy "Members can read their quiz instance"
  on public."QuizInstance"
  for select
  to authenticated
  using (
    "hostId" = (select auth.uid())
    or (select auth.uid()) = any ("attendingPlayers")
  );

-- Only members of the instance named in the topic may receive broadcasts.
-- Compared as text so a non-quiz topic cannot throw an invalid-uuid error.
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
