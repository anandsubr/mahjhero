create type public.club_role as enum ('host', 'co_organizer', 'member');
create type public.club_visibility as enum ('public', 'private');
create type public.member_status as enum ('active', 'removed');

create table public.clubs (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  slug             text not null unique,
  -- Free text like "Thursday evenings". The design asks for it on the create
  -- screen and shows it on club cards; it is a human hint, never parsed.
  rhythm           text not null default '',
  visibility       public.club_visibility not null default 'private',
  timezone         text not null default 'America/New_York',
  reminder_offsets int[] not null default '{1440, 120}',
  created_by       uuid not null references public.profiles(id),
  created_at       timestamptz not null default now()
);

create table public.club_members (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       public.club_role not null default 'member',
  status     public.member_status not null default 'active',
  joined_at  timestamptz not null default now(),
  unique (club_id, profile_id)
);

create table public.club_invites (
  id            uuid primary key default gen_random_uuid(),
  club_id       uuid not null references public.clubs(id) on delete cascade,
  token         text not null unique,
  email         text,
  display_name  text,
  skill_level   public.skill_level,
  invited_by    uuid not null references public.profiles(id),
  expires_at    timestamptz not null default (now() + interval '30 days'),
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create index club_members_profile_idx on public.club_members (profile_id);
create index club_invites_token_idx on public.club_invites (token);

-- Breaks policy recursion: club_members' own policy would otherwise ask the
-- same question it is answering. Definer rights plus a pinned search_path.
create function public.is_club_member(target_club uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = target_club
      and profile_id = auth.uid()
      and status = 'active'
  );
$$;

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_invites enable row level security;

create policy clubs_select_member on public.clubs
  for select using (public.is_club_member(id));

-- Anyone signed in may create a club; Task 2 makes them its host in the same
-- transaction, so a club without a host is not reachable through the app.
create policy clubs_insert_any on public.clubs
  for insert with check (auth.uid() = created_by);

create policy clubs_update_host on public.clubs
  for update using (
    exists (
      select 1 from public.club_members m
      where m.club_id = clubs.id and m.profile_id = auth.uid()
        and m.role = 'host' and m.status = 'active'
    )
  );

create policy club_members_select_member on public.club_members
  for select using (public.is_club_member(club_id));

-- Roles are changed only through a definer function (a later plan). Direct
-- writes are refused so a member cannot promote themselves.
create policy club_members_insert_self on public.club_members
  for insert with check (auth.uid() = profile_id);

create policy club_invites_select_organizer on public.club_invites
  for select using (
    exists (
      select 1 from public.club_members m
      where m.club_id = club_invites.club_id and m.profile_id = auth.uid()
        and m.role in ('host', 'co_organizer') and m.status = 'active'
    )
  );

create policy club_invites_insert_organizer on public.club_invites
  for insert with check (
    exists (
      select 1 from public.club_members m
      where m.club_id = club_invites.club_id and m.profile_id = auth.uid()
        and m.role in ('host', 'co_organizer') and m.status = 'active'
    )
  );

-- RLS filters; it does not grant. Without these the policies are unreachable
-- and every query fails with "permission denied".
grant select, insert, update on public.clubs to authenticated;
grant select, insert on public.club_members to authenticated;
grant select, insert on public.club_invites to authenticated;

-- Widen the profiles read policy: a member may see co-members, so rosters can
-- show names and skill levels. Strangers stay invisible.
drop policy if exists profiles_select_own on public.profiles;

create policy profiles_select_self_or_comember on public.profiles
  for select using (
    auth.uid() = id
    or exists (
      select 1
      from public.club_members mine
      join public.club_members theirs on theirs.club_id = mine.club_id
      where mine.profile_id = auth.uid() and mine.status = 'active'
        and theirs.profile_id = profiles.id and theirs.status = 'active'
    )
  );
