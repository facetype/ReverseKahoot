-- Creates a public."Profile" row for every new auth user, using the username
-- chosen on the sign-up page (sent as auth metadata "userName").
--
-- Run this once in the Supabase SQL editor (or with `supabase db push`).
-- Assumes public."Profile" already exists with columns:
--   "userId"   uuid  primary key, references auth.users(id)
--   "userName" text  not null

-- Usernames must be unique, case-insensitively.
create unique index if not exists "Profile_userName_key"
  on public."Profile" (lower("userName"));

-- Copy the username from auth metadata into Profile when a user is created.
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
    -- Fall back to the local part of the email so the row always exists.
    chosen_name := split_part(new.email, '@', 1);
  end if;

  insert into public."Profile" ("userId", "userName")
  values (new.id, chosen_name)
  on conflict ("userId") do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row level security: anyone may read usernames (they are display names),
-- users may only insert or change their own row.
alter table public."Profile" enable row level security;

drop policy if exists "Profiles are readable by everyone" on public."Profile";
create policy "Profiles are readable by everyone"
  on public."Profile" for select
  using (true);

drop policy if exists "Users can insert their own profile" on public."Profile";
create policy "Users can insert their own profile"
  on public."Profile" for insert
  to authenticated
  with check (auth.uid() = "userId");

drop policy if exists "Users can update their own profile" on public."Profile";
create policy "Users can update their own profile"
  on public."Profile" for update
  to authenticated
  using (auth.uid() = "userId")
  with check (auth.uid() = "userId");
