/*
 * The venue master.
 *
 * This is the only table in this schema that crosses clubs, and it is
 * therefore the one place where the uniform "rows are visible to active
 * members of that club" policy does not apply. Read the select policy and the
 * function guards together: the policy answers "may you see this row", the
 * guards answer "may you change it", and those are different questions with
 * different answers.
 *
 * `visibility` defaults to 'club'. A great deal of mahjong is played in
 * members' homes, and a master list built with future public discovery in
 * mind must not publish "Marie's place, 42 Elm Street" as a side effect of
 * someone scheduling Tuesday's game. Sharing is a deliberate act.
 *
 * `added_by_club_id` is named for what it records — who typed it in — rather
 * than `owner_club_id`, because that club is a steward, not an owner. When
 * venue claiming arrives, authority transfers to the claimant rather than
 * accumulating: a claimed venue becomes editable by its claimant and no
 * longer by the club that added it. That is a change to `update_venue`'s
 * guard and nothing else.
 */

create type public.venue_visibility as enum ('club', 'public');

create table public.venues (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  address_line     text,
  locality         text,
  region           text,
  postal_code      text,
  visibility       public.venue_visibility not null default 'club',
  added_by_club_id uuid not null references public.clubs(id),
  archived_at      timestamptz,
  created_by       uuid not null references public.profiles(id)
                     default auth.uid(),
  created_at       timestamptz not null default now()
);

/*
 * Duplicate control for the shared set only. Two clubs each keeping their own
 * "Community Hall" is correct and must stay legal; two rows for the same
 * public hall is a mess nobody can merge, because no merge tool exists.
 *
 * This catches identical names in the same locality and nothing more —
 * "St Mary's Hall" and "St. Marys Parish Hall" are one building to a human
 * and two rows to Postgres. Bounded damage: nothing depends on venue
 * identity yet.
 */
create unique index venues_public_name_idx
  on public.venues (lower(trim(name)), coalesce(lower(trim(locality)), ''))
  where visibility = 'public';

create index venues_club_idx on public.venues (added_by_club_id);

/*
 * Mirrors is_club_member, for the same reason: a policy that asked this
 * question directly against club_members would recurse through that table's
 * own policy. Definer rights plus a pinned search_path.
 *
 * Lives in this migration rather than the events one because the venue write
 * functions below are its first callers.
 */
create function public.is_club_organizer(target_club uuid)
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
      and role in ('host', 'co_organizer')
  );
$$;

/*
 * The guard every mutation opens with, in one place.
 *
 * Not folded into is_club_organizer, which is also called from inside RLS
 * policies where a raise would be wrong — a policy wants false, a function
 * wants 42501. Two names for the two jobs.
 */
create function public.assert_club_organizer(target_club uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not public.is_club_organizer(target_club) then
    raise exception 'not an organizer of this club' using errcode = '42501';
  end if;
end;
$$;

alter table public.venues enable row level security;

-- The cross-club read. Public venues are visible to every signed-in member;
-- everything else is visible only to the club that added it.
create policy venues_select_public_or_member on public.venues
  for select using (
    visibility = 'public' or public.is_club_member(added_by_club_id)
  );

/*
 * No insert, update or delete policy, and no DML grant. Every write goes
 * through the functions below, which check is_club_organizer against the
 * venue's OWN club rather than against "some club the caller organizes".
 *
 * Plan 2 shipped `club_members_insert_self` with
 * `with check (auth.uid() = profile_id)`, which constrained who a row was
 * about and not which club it belonged to, and any member could make
 * themselves host of any club. The shape of that mistake is what these
 * guards are written against.
 */

create function public.create_venue(
  venue_name    text,
  address_line  text default null,
  locality      text default null,
  region        text default null,
  postal_code   text default null,
  target_club   uuid default null,
  share_publicly boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  perform public.assert_club_organizer(target_club);

  if length(trim(coalesce(venue_name, ''))) = 0 then
    raise exception 'venue name is required' using errcode = '23514';
  end if;

  insert into public.venues (
    name, address_line, locality, region, postal_code,
    visibility, added_by_club_id, created_by
  ) values (
    trim(venue_name),
    nullif(trim(coalesce(address_line, '')), ''),
    nullif(trim(coalesce(locality, '')), ''),
    nullif(trim(coalesce(region, '')), ''),
    nullif(trim(coalesce(postal_code, '')), ''),
    case when share_publicly then 'public' else 'club' end::public.venue_visibility,
    target_club,
    auth.uid()
  )
  returning id into new_id;

  return new_id;
end;
$$;

/*
 * A null argument means "leave this alone", not "clear this". A screen that
 * edits only the name would otherwise wipe the address, and the host would
 * have no way to know it had happened.
 *
 * `visibility` is deliberately not editable here. Turning a venue public is
 * its own act with its own consequences (another club may start using it, at
 * which point it cannot be retracted without breaking their events), and it
 * gets its own function when a screen needs it — not a null-defaulted
 * parameter on the general edit path.
 */
create function public.update_venue(
  target_venue    uuid,
  venue_name      text default null,
  new_address_line text default null,
  new_locality    text default null,
  new_region      text default null,
  new_postal_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  steward uuid;
begin
  select added_by_club_id into steward
  from public.venues where id = target_venue;

  if steward is null then
    raise exception 'no such venue' using errcode = 'P0002';
  end if;

  perform public.assert_club_organizer(steward);

  -- Parameters are named distinctly from the columns they update
  -- (new_address_line vs. address_line, etc.) because plpgsql treats an
  -- unqualified name inside UPDATE ... SET as ambiguous when a parameter and
  -- a column share it — unlike venue_name/name, which were already distinct.
  update public.venues set
    name         = coalesce(nullif(trim(coalesce(venue_name, '')), ''), name),
    address_line = coalesce(new_address_line, address_line),
    locality     = coalesce(new_locality, locality),
    region       = coalesce(new_region, region),
    postal_code  = coalesce(new_postal_code, postal_code)
  where id = target_venue;

  return true;
end;
$$;

/*
 * Venues are archived, never deleted. Past events point at them, and a club's
 * history should not develop holes because a hall closed.
 */
create function public.archive_venue(target_venue uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  steward uuid;
begin
  select added_by_club_id into steward
  from public.venues where id = target_venue;

  if steward is null then
    raise exception 'no such venue' using errcode = 'P0002';
  end if;

  perform public.assert_club_organizer(steward);

  update public.venues set archived_at = now() where id = target_venue;
  return true;
end;
$$;

/*
 * The typeahead's only data source. Returns the caller's own club venues and
 * public ones, own club first, non-archived only, capped at 20.
 *
 * Plain `ilike` rather than pg_trgm: the public set starts empty and a club
 * has a handful of venues, so an extension dependency would be bought for
 * nothing. A trigram index is the upgrade when the shared set is large enough
 * to need one.
 *
 * The membership check is not decorative. Without it this definer function
 * would happily search on behalf of a club the caller has nothing to do with,
 * and report back which venues that club uses.
 */
create function public.search_venues(target_club uuid, q text)
returns table (
  id           uuid,
  name         text,
  address_line text,
  locality     text,
  visibility   public.venue_visibility,
  is_own_club  boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  return query
  select v.id, v.name, v.address_line, v.locality, v.visibility,
         v.added_by_club_id = target_club as is_own_club
  from public.venues v
  where v.archived_at is null
    and (v.added_by_club_id = target_club or v.visibility = 'public')
    and (
      q is null or length(trim(q)) = 0
      or v.name ilike '%' || trim(q) || '%'
      or coalesce(v.locality, '') ilike '%' || trim(q) || '%'
    )
  order by (v.added_by_club_id = target_club) desc, v.name
  limit 20;
end;
$$;

-- Grants, verb for verb against the policies. `alter default privileges` in
-- 20260822041836 means this table starts with nothing for authenticated, and
-- 20260822180200 means service_role already has DML.
grant select on public.venues to authenticated;

-- A null proacl is EXECUTE to PUBLIC. `from public` clears the PostgreSQL
-- default; `from anon` clears the direct grant Supabase's hosted bootstrap
-- adds, which `from public` does not touch.
revoke execute on function public.is_club_organizer(uuid) from public, anon;
grant  execute on function public.is_club_organizer(uuid) to authenticated;

-- Not granted to authenticated: it is only ever called from inside the
-- definer functions below, which run as their owner.
revoke execute on function public.assert_club_organizer(uuid) from public, anon;

revoke execute on function public.create_venue(text, text, text, text, text, uuid, boolean)
  from public, anon;
grant  execute on function public.create_venue(text, text, text, text, text, uuid, boolean)
  to authenticated;

revoke execute on function public.update_venue(uuid, text, text, text, text, text)
  from public, anon;
grant  execute on function public.update_venue(uuid, text, text, text, text, text)
  to authenticated;

revoke execute on function public.archive_venue(uuid) from public, anon;
grant  execute on function public.archive_venue(uuid) to authenticated;

revoke execute on function public.search_venues(uuid, text) from public, anon;
grant  execute on function public.search_venues(uuid, text) to authenticated;
