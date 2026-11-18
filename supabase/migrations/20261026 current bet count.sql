-- How many bets the open question has, for the "bets placed" counter.
--
-- Only the host and the joined players may ask, and only for their own game.
create or replace function public.current_bet_count(p_instance_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(b.*)::integer
  from public."QuizInstance" qi
  join public."Bet" b
    on b."gameId" = qi."gameId"
   and b."questionId" = (qi."currentQuestion" ->> 'questionId')::integer
  where qi.id = p_instance_id
    and qi."phase" = 'question'
    and (qi."hostId" = auth.uid() or auth.uid() = any (qi."attendingPlayers"));
$$;

revoke execute on function public.current_bet_count(uuid) from public, anon;
grant execute on function public.current_bet_count(uuid) to authenticated;