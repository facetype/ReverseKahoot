-- Lets a signed-in user host games: insert a GameHistory row they own and read
-- their own rows back (hostGame() selects the new row to get its code).
-- "userId" is filled from the JWT by the set_owner trigger, which runs before
-- these checks. Looking a game up by code as a player is a separate policy.
-- Idempotent.

drop policy if exists "Hosts can create their own games" on public."GameHistory";
create policy "Hosts can create their own games"
  on public."GameHistory"
  for insert
  to authenticated
  with check ("userId" = auth.uid());

drop policy if exists "Hosts can read their own games" on public."GameHistory";
create policy "Hosts can read their own games"
  on public."GameHistory"
  for select
  to authenticated
  using ("userId" = auth.uid());
