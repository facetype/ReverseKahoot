-- Joining must hold the instance's row lock from the started check through the
-- membership update. Concurrent joins then see each other's players, and the
-- UPDATE in StartQuizInstance takes the same lock before closing the lobby.
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

  if instance."isStarted" then
    raise exception using errcode = 'PT409', message = 'This game has already started.';
  end if;

  already_joined := coalesce(p_player_id = any (instance."attendingPlayers"), false);
  if not already_joined then
    update public."QuizInstance" qi
    set "attendingPlayers" = array_append(coalesce(qi."attendingPlayers", '{}'), p_player_id)
    where qi.id = instance.id
    returning qi.* into instance;
  end if;

  return to_jsonb(instance) || jsonb_build_object('alreadyJoined', already_joined);
end;
$$;

-- Only the Edge Function's admin client may supply a player identity. The Edge
-- Function takes it from the verified JWT, rather than accepting it in the body.
revoke execute on function public.join_quiz_instance(text, uuid) from public, anon, authenticated;
grant execute on function public.join_quiz_instance(text, uuid) to service_role;
