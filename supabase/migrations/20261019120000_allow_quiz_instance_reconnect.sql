-- Reconnect support. Members — the host or a player already on the list — can
-- rejoin even after the game has started, so a reload, a lost connection or a
-- revisited join code finds its way back into the game instead of a 409.
-- New players stay locked out once the host has started.
--
-- The host counts as a member but is never appended to "attendingPlayers":
-- joining your own game with its code is a reconnect, not a player join.
create or replace function public.join_quiz_instance(
  p_join_code text,
  p_player_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  instance public."QuizInstance"%rowtype;
  already_joined boolean;
begin
  if p_player_id is null then
    raise exception using errcode = '22004', message = 'A player identity is required.';
  end if;

  select qi.* into instance
  from public."QuizInstance" qi
  where qi."joinCode" = p_join_code
  for update;

  if not found then
    raise exception using
      errcode = 'PT404',
      message = format('No game has the join code "%s".', p_join_code);
  end if;

  already_joined :=
    p_player_id = instance."hostId"
    or coalesce(p_player_id = any (instance."attendingPlayers"), false);

  if instance."isStarted" and not already_joined then
    raise exception using errcode = 'PT409', message = 'This game has already started.';
  end if;

  if not already_joined then
    update public."QuizInstance" qi
    set "attendingPlayers" = array_append(coalesce(qi."attendingPlayers", '{}'), p_player_id)
    where qi.id = instance.id
    returning qi.* into instance;
  end if;

  return to_jsonb(instance) || jsonb_build_object('alreadyJoined', already_joined);
end;
$$;

-- create or replace keeps existing grants; restate them anyway so this
-- migration stands on its own and matches the original grant set.
revoke execute on function public.join_quiz_instance(text, uuid) from public, anon, authenticated;
grant execute on function public.join_quiz_instance(text, uuid) to service_role;
