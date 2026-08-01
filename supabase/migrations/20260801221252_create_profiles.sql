create type public.skill_level as enum ('beginner', 'intermediate', 'advanced');
create type public.notify_channel as enum ('push', 'email', 'both');

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text not null default '',
  skill_level         public.skill_level,
  avatar_url          text,
  timezone            text not null default 'America/New_York',
  notify_channel      public.notify_channel not null default 'both',
  mute_need_a_fourth  boolean not null default false,
  quiet_hours_enabled boolean not null default true,
  quiet_hours_start   time not null default '21:00',
  quiet_hours_end     time not null default '08:00',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

create policy profiles_update_own on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Local/hosted config does not auto-expose new tables to API roles, so the
-- `authenticated` role needs an explicit grant before RLS policies are even
-- reachable. Grants define coarse table access; RLS filters rows within it.
grant select, update on public.profiles to authenticated;

-- Create a profile whenever an auth user is created, by any provider.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
