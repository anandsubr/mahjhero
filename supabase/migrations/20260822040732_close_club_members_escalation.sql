-- Corrective migration. `20260822033527_create_clubs.sql` shipped and was
-- applied to the hosted dev project with a Critical cross-tenant escalation
-- hole: `club_members_insert_self` checked `auth.uid() = profile_id` and
-- nothing about which club or what role, so any authenticated user holding a
-- club's uuid (not secret — every invitee learns one) could insert
-- themselves into that club as host, then read its roster, every
-- co-member's profile via the widened profiles policy, and later its events
-- and bookings.
--
-- That migration was amended in place during development to close the hole,
-- but the Supabase CLI tracks applied migrations by version timestamp, not
-- by content hash: `supabase db push` saw `20260822033527` already recorded
-- as applied on the hosted project and reported "up to date" with an empty
-- migrations list — no error, and the amended content was silently never
-- sent. The hole stayed live on hosted while local looked fixed.
--
-- This project's rule is forward-only: once a migration has been applied
-- anywhere, it is never hand-edited again — every fix is a new migration on
-- top, so local and hosted replay the same linear history and always end up
-- in the same state. `20260822033527_create_clubs.sql` has been restored to
-- byte-match what actually ran; this file carries every delta between that
-- restored version and the fix.

-- No insert policy or grant on clubs either: `create_club` below is the only
-- way in, so a club and its host row are always created together.
drop policy clubs_insert_any on public.clubs;
revoke insert on public.clubs from authenticated;

-- The hole itself. Memberships are now created only by `create_club` below
-- and by `accept_club_invite` (Task 3), both `security definer`. Do not add
-- an insert policy back on club_members — the only workable shape for one
-- (`with check (auth.uid() = profile_id)`) is exactly this bug.
drop policy club_members_insert_self on public.club_members;
revoke insert on public.club_members from authenticated;

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

-- Nullable with `set null`: deleting an account must not fail, and must not
-- take the club with it. Without this, the cascade from auth.users into
-- profiles aborts here, so account deletion is impossible for anyone who has
-- ever created a club.
alter table public.clubs alter column created_by drop not null;
alter table public.clubs drop constraint clubs_created_by_fkey;
alter table public.clubs
  add constraint clubs_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

-- Same reasoning for the two profile references on club_invites.
alter table public.club_invites alter column invited_by drop not null;
alter table public.club_invites drop constraint club_invites_invited_by_fkey;
alter table public.club_invites
  add constraint club_invites_invited_by_fkey
  foreign key (invited_by) references public.profiles(id) on delete set null;

alter table public.club_invites drop constraint club_invites_accepted_by_fkey;
alter table public.club_invites
  add constraint club_invites_accepted_by_fkey
  foreign key (accepted_by) references public.profiles(id) on delete set null;

-- token already has a btree from its unique constraint; club_id does not,
-- and the cascade from clubs would otherwise sequential-scan.
drop index if exists public.club_invites_token_idx;
create index club_invites_club_idx on public.club_invites (club_id);
