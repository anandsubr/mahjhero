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
  -- Nullable with `set null`: deleting an account must not fail, and must not
  -- take the club with it. Without this, the cascade from auth.users into
  -- profiles aborts here, so account deletion is impossible for anyone who
  -- has ever created a club.
  created_by       uuid references public.profiles(id) on delete set null,
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
  invited_by    uuid references public.profiles(id) on delete set null,
  expires_at    timestamptz not null default (now() + interval '30 days'),
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index club_members_profile_idx on public.club_members (profile_id);
-- token already has a btree from its unique constraint; club_id does not,
-- and the cascade from clubs would otherwise sequential-scan.
create index club_invites_club_idx on public.club_invites (club_id);

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

-- No insert policy on clubs either: `create_club` below is the only way in,
-- so a club and its host row are always created together. A club with no
-- member is unreachable by anyone — every policy here is membership-scoped —
-- and its unique slug would be squatted permanently.

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

-- NOTE: there is deliberately NO insert policy and NO insert grant on
-- club_members. Memberships are created only by `create_club` below and by
-- `accept_club_invite` (Task 3), both `security definer`.
--
-- The obvious policy — `with check (auth.uid() = profile_id)` — is a
-- cross-tenant breach: it constrains WHO the row is about and says nothing
-- about WHICH club or WHAT role, so any authenticated user holding a club's
-- uuid could insert themselves into it as host. Club uuids are not secret;
-- every invitee learns one. Do not add that policy back.

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

/*
 * Creates a club and seats the caller as its host, atomically.
 *
 * security definer because there is no insert policy on either table — that
 * is the point. A client-side two-write version would need an insert policy
 * on club_members, and the only workable shape for one
 * (`with check (auth.uid() = profile_id)`) lets anybody join any club as
 * host. Doing it here means memberships can only ever be created by code
 * that decides both the club and the role.
 *
 * RLS does not protect this function, so it validates its own inputs.
 */
create function public.create_club(club_name text, club_rhythm text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  new_id uuid;
  base_slug text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if length(trim(club_name)) = 0 then
    raise exception 'club name is required' using errcode = '22023';
  end if;

  base_slug := regexp_replace(lower(trim(club_name)), '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);

  if length(base_slug) = 0 then
    raise exception 'club name needs a letter or number'
      using errcode = '22023';
  end if;

  -- Suffix rather than collide: two clubs may legitimately share a name, and
  -- surfacing a raw unique-violation to the member helps nobody.
  insert into public.clubs (name, slug, rhythm, created_by)
  values (
    trim(club_name),
    base_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6),
    trim(coalesce(club_rhythm, '')),
    caller
  )
  returning id into new_id;

  insert into public.club_members (club_id, profile_id, role)
  values (new_id, caller, 'host');

  return new_id;
end;
$$;

grant execute on function public.create_club(text, text) to authenticated;

-- RLS filters; it does not grant. Without these the policies are unreachable
-- and every query fails with "permission denied".
--
-- Note what is NOT granted: no insert on clubs or club_members (definer
-- functions own that), and no delete anywhere (removing members and deleting
-- clubs is a later plan, and both need decisions about what happens to that
-- member's bookings).
grant select, update on public.clubs to authenticated;
grant select on public.club_members to authenticated;
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
