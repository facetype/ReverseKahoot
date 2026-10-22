-- Owner columns are always the signed-in user's id, no matter what the client sends.
-- Applied to the live project on 2026-09-23. Idempotent.
--
-- Two layers:
--   1. Column defaults of auth.uid(), so clients can simply omit "userId".
--   2. A BEFORE INSERT trigger that overwrites "userId" with auth.uid() whenever
--      a request carries a JWT. Admin/dashboard inserts (no JWT) keep the value
--      they provide, which the Profile sign-up trigger relies on.

alter table public."Profile"     alter column "userId" set default auth.uid();
alter table public."Category"    alter column "userId" set default auth.uid();
alter table public."Quiz"        alter column "userId" set default auth.uid();
alter table public."GameHistory" alter column "userId" set default auth.uid();

create or replace function public.set_owner_from_session()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new."userId" := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_owner on public."Profile";
create trigger set_owner before insert on public."Profile"
  for each row execute function public.set_owner_from_session();

drop trigger if exists set_owner on public."Category";
create trigger set_owner before insert on public."Category"
  for each row execute function public.set_owner_from_session();

drop trigger if exists set_owner on public."Quiz";
create trigger set_owner before insert on public."Quiz"
  for each row execute function public.set_owner_from_session();

drop trigger if exists set_owner on public."GameHistory";
create trigger set_owner before insert on public."GameHistory"
  for each row execute function public.set_owner_from_session();
