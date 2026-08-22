begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(56);

/*
 * Guards the privileges themselves, not the policies.
 *
 * Supabase grants ALL on every table in `public` to `authenticated` by
 * default, and a later `grant select` only adds to that. ALL includes
 * TRUNCATE — which is **not subject to row-level security**, so a member
 * could empty any of these tables no matter how the policies read.
 *
 * Every RLS assertion elsewhere passed while that was true, because they all
 * test row filtering and TRUNCATE never consults a policy. These assertions
 * are the only thing standing between a future `create table` and the same
 * hole reopening.
 */

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE'),
  'authenticated cannot TRUNCATE profiles'
);
select ok(
  not has_table_privilege('authenticated', 'public.clubs', 'TRUNCATE'),
  'authenticated cannot TRUNCATE clubs'
);
select ok(
  not has_table_privilege('authenticated', 'public.club_members', 'TRUNCATE'),
  'authenticated cannot TRUNCATE club_members'
);
select ok(
  not has_table_privilege('authenticated', 'public.club_invites', 'TRUNCATE'),
  'authenticated cannot TRUNCATE club_invites'
);

-- Memberships are created only by security definer functions. An insert
-- privilege here would let a client write its own role.
select ok(
  not has_table_privilege('authenticated', 'public.club_members', 'INSERT'),
  'authenticated cannot INSERT into club_members'
);
select ok(
  not has_table_privilege('authenticated', 'public.clubs', 'INSERT'),
  'authenticated cannot INSERT into clubs'
);

-- No table here has an anon policy, so anon should reach none of them.
select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anon cannot read profiles'
);
select ok(
  not has_table_privilege('anon', 'public.clubs', 'SELECT'),
  'anon cannot read clubs'
);

-- The positive case, so this file cannot pass by revoking everything.
select ok(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  'authenticated can still read profiles'
);

-- ---------------------------------------------------------------------------
-- Table-level catch-all.
--
-- Everything above enumerates specific tables by name, which means a new
-- `create table` in `public` is invisible to this file until someone
-- remembers to come back and add it here. Proven: `create table
-- public.new_thing(id uuid primary key); grant all on public.new_thing to
-- authenticated, anon;` left the suite green before these two assertions
-- existed. Supabase's hosted bootstrap grants ALL — including TRUNCATE,
-- which RLS never filters — to `authenticated` on every new table in
-- `public`, and no table in this schema has an `anon` policy. These two
-- assertions catch a table that inherits either default, the same way the
-- function catch-all further down catches an unguarded function. Restricted
-- to `relkind = 'r'` (ordinary tables) so views and other relations in
-- `public` do not create noise.
-- ---------------------------------------------------------------------------

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and has_table_privilege('authenticated', c.oid, 'TRUNCATE')),
  '',
  'no table in schema public is TRUNCATE-able by authenticated'
);

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and has_table_privilege('anon', c.oid, 'SELECT')),
  '',
  'no table in schema public is reachable by anon'
);

-- ---------------------------------------------------------------------------
-- Function EXECUTE ACLs.
--
-- This file's blind spot, and the reason a review found `create_club` and
-- `is_club_member` still callable by `anon` after a migration had supposedly
-- closed that: it only ever looked at tables. Functions have the same problem
-- in a nastier form, because there are two independent default grants and
-- neither is visible in the migration that creates the function.
--
--   1. PostgreSQL grants EXECUTE on every new function to the PUBLIC
--      pseudo-role. A `proacl` of NULL means exactly this, and reads as
--      "no grants" to anyone skimming.
--   2. Supabase's hosted bootstrap additionally grants EXECUTE *directly* to
--      anon, authenticated and service_role. `revoke ... from public` does not
--      touch a direct grant, so the obvious fix silently only half-works —
--      which is how 20260822045809 came to exist.
--
-- Every function in this schema is `security definer`, so an EXECUTE grant to
-- anon is a grant to the entire internet. Today each one guards itself with a
-- `caller is null` check; that is one refactor from being the only thing
-- standing between anon and the tenant boundary.
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.create_club(text, text)', 'EXECUTE'),
  'anon cannot execute create_club'
);
select ok(
  not has_function_privilege('anon', 'public.is_club_member(uuid)', 'EXECUTE'),
  'anon cannot execute is_club_member'
);
select ok(
  not has_function_privilege('anon', 'public.accept_club_invite(text)', 'EXECUTE'),
  'anon cannot execute accept_club_invite'
);
select ok(
  not has_function_privilege('anon', 'public.club_roster(uuid)', 'EXECUTE'),
  'anon cannot execute club_roster'
);

-- The catch-all, and the assertion that actually earns its keep: it fails for
-- any function added from here on that inherits either default. A future
-- function that genuinely needs anon has to change this line deliberately,
-- which is the whole point. Trigger functions are included — they are never
-- called directly, so nobody needs EXECUTE on them either.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  '',
  'no function in schema public is executable by anon'
);

-- The positive cases, so the block above cannot pass by revoking everything.
-- is_club_member in particular is called from inside RLS policies on clubs
-- and club_members, which evaluate as the querying role: revoking it from
-- authenticated breaks every club read in the app.
select ok(
  has_function_privilege('authenticated', 'public.is_club_member(uuid)', 'EXECUTE'),
  'authenticated can still execute is_club_member'
);
select ok(
  has_function_privilege('authenticated', 'public.club_roster(uuid)', 'EXECUTE'),
  'authenticated can still execute club_roster'
);
select ok(
  has_function_privilege('authenticated', 'public.create_club(text, text)', 'EXECUTE'),
  'authenticated can still execute create_club'
);
select ok(
  has_function_privilege('authenticated', 'public.accept_club_invite(text)', 'EXECUTE'),
  'authenticated can still execute accept_club_invite'
);

-- ---------------------------------------------------------------------------
-- Event/table mutation ACLs (fix pass 1).
--
-- Only observable against hosted: this suite runs with --linked, and the
-- local stack grants nothing to authenticated by default, which is exactly
-- why local passed even before assert_venue_available's revoke was added.
-- Supabase's hosted bootstrap grants EXECUTE directly to authenticated at
-- function-creation time, and `revoke ... from public` never clears a
-- direct grant, so the negative assertions below are the only thing that
-- actually proves the hardening took.
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege(
    'authenticated', 'public.assert_venue_available(uuid, uuid)', 'EXECUTE'),
  'authenticated cannot execute assert_venue_available'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.assert_club_organizer(uuid)', 'EXECUTE'),
  'authenticated cannot execute assert_club_organizer'
);

-- The positive cases, so the two assertions above cannot pass by revoking
-- everything: the six client-facing event/table mutations must still be
-- reachable.
select ok(
  has_function_privilege(
    'authenticated',
    'public.create_event(uuid, text, uuid, text, timestamptz, timestamptz, int)',
    'EXECUTE'),
  'authenticated can still execute create_event'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_event(uuid, text, uuid, text, timestamptz, timestamptz)',
    'EXECUTE'),
  'authenticated can still execute update_event'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.cancel_event(uuid)', 'EXECUTE'),
  'authenticated can still execute cancel_event'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.add_event_table(uuid)', 'EXECUTE'),
  'authenticated can still execute add_event_table'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_event_table(uuid, text, public.skill_tier)',
    'EXECUTE'),
  'authenticated can still execute update_event_table'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.remove_event_table(uuid)', 'EXECUTE'),
  'authenticated can still execute remove_event_table'
);

-- ---------------------------------------------------------------------------
-- service_role table grants.
--
-- 20260822045809's comment asserted that "every table grant in this schema
-- already gives service_role full access by design". It did not. After
-- 20260822041836's `revoke all ... from anon, authenticated`, service_role
-- was left holding only what Supabase's default privileges gave it —
-- `Dxtm`, i.e. TRUNCATE, REFERENCES, TRIGGER, MAINTAIN — and no DML at all.
--
-- service_role has BYPASSRLS, which skips policies. Grants are a separate
-- gate and BYPASSRLS does nothing for them, so the first Edge Function the
-- notifications plan writes would have hit `permission denied for table
-- profiles` while every policy looked correct.
-- ---------------------------------------------------------------------------

select ok(
  has_table_privilege('service_role', 'public.profiles', 'SELECT, INSERT, UPDATE, DELETE'),
  'service_role has DML on profiles'
);
select ok(
  has_table_privilege('service_role', 'public.clubs', 'SELECT, INSERT, UPDATE, DELETE'),
  'service_role has DML on clubs'
);
select ok(
  has_table_privilege('service_role', 'public.club_members', 'SELECT, INSERT, UPDATE, DELETE'),
  'service_role has DML on club_members'
);
select ok(
  has_table_privilege('service_role', 'public.club_invites', 'SELECT, INSERT, UPDATE, DELETE'),
  'service_role has DML on club_invites'
);

-- ---------------------------------------------------------------------------
-- Series mutation ACLs (Task 6).
--
-- Same blind spot as the event/table block above, and the same fix: hosted's
-- bootstrap grants EXECUTE directly to `authenticated`, so the trigger
-- function's negative assertion here is the only thing that actually proves
-- it was revoked from `authenticated` and not just from `public, anon`.
-- ---------------------------------------------------------------------------

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_event_series(uuid, text, uuid, text, public.series_frequency, smallint, smallint, time, int, int, date, date)',
    'EXECUTE'),
  'authenticated can still execute create_event_series'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.update_event_series(uuid, text, uuid, text, time, int, int, date, boolean)',
    'EXECUTE'),
  'authenticated can still execute update_event_series'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.end_event_series(uuid, boolean)', 'EXECUTE'),
  'authenticated can still execute end_event_series'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.reflow_events_for_timezone()', 'EXECUTE'),
  'authenticated cannot execute reflow_events_for_timezone'
);

-- Task 14 puts a "Reset to the series" button on the event screen, so this
-- one is called by a signed-in host directly, not by a trigger.
select ok(
  has_function_privilege(
    'authenticated', 'public.reset_event_to_series(uuid)', 'EXECUTE'),
  'authenticated can still execute reset_event_to_series'
);

-- ---------------------------------------------------------------------------
-- Scheduling ACLs (Task 7).
--
-- The four tables plan 3 adds. Same reasoning as the four above: ALL is the
-- Supabase bootstrap default and includes TRUNCATE, which RLS does not
-- filter.
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'public.venues', 'TRUNCATE'),
  'authenticated cannot TRUNCATE venues'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_series', 'TRUNCATE'),
  'authenticated cannot TRUNCATE event_series'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'TRUNCATE'),
  'authenticated cannot TRUNCATE events'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_tables', 'TRUNCATE'),
  'authenticated cannot TRUNCATE event_tables'
);

-- Clients read these tables and never write them. Every mutation is a
-- security definer function that checks the caller's role against the row's
-- own club.
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'INSERT'),
  'authenticated cannot insert venues'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'INSERT'),
  'authenticated cannot insert events'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'UPDATE'),
  'authenticated cannot update events'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'DELETE'),
  'authenticated cannot delete events'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_tables', 'INSERT'),
  'authenticated cannot insert event_tables'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_series', 'INSERT'),
  'authenticated cannot insert event_series'
);

-- service_role needs DML, because Edge Functions and scheduled jobs run as
-- it and BYPASSRLS skips policies, not grants.
select ok(
  has_table_privilege('service_role', 'public.events', 'INSERT'),
  'service_role can insert events'
);
select ok(
  has_table_privilege('service_role', 'public.venues', 'SELECT'),
  'service_role can select venues'
);

-- Function ACLs. A null proacl is EXECUTE to PUBLIC, so "nobody granted it"
-- and "everybody has it" look identical until you assert.
select ok(
  not has_function_privilege('anon',
    'public.create_event(uuid, text, uuid, text, timestamptz, timestamptz, int)',
    'EXECUTE'),
  'anon cannot execute create_event'
);
select ok(
  not has_function_privilege('anon',
    'public.create_venue(text, text, text, text, text, uuid, boolean)',
    'EXECUTE'),
  'anon cannot execute create_venue'
);
select ok(
  not has_function_privilege('anon', 'public.search_venues(uuid, text)',
    'EXECUTE'),
  'anon cannot execute search_venues'
);
select ok(
  not has_function_privilege('authenticated',
    'public.assert_club_organizer(uuid)', 'EXECUTE'),
  'authenticated cannot execute assert_club_organizer'
);

-- The sweep function takes no club argument and checks no membership,
-- because it is maintenance across every series in the system. That is
-- exactly why authenticated must not reach it.
select ok(
  not has_function_privilege('authenticated',
    'public.materialize_event_series(int)', 'EXECUTE'),
  'authenticated cannot execute materialize_event_series'
);
select ok(
  not has_function_privilege('authenticated',
    'public.materialize_one_series(uuid, int)', 'EXECUTE'),
  'authenticated cannot execute materialize_one_series'
);

/*
 * The catch-all above this block enumerates functions reachable by `anon`.
 * This is the mirror for `authenticated`, because the hosted project
 * bootstraps every new function with EXECUTE granted DIRECTLY to anon,
 * authenticated and service_role — and `revoke ... from public` does not
 * clear a direct grant (see 20260822045809). An anon-only catch-all
 * therefore cannot see an unintended authenticated grant, which is how
 * series_occurrence_dates shipped reachable on hosted while local looked
 * clean.
 *
 * Asserts equality, not "nothing extra beyond this list". A `not in (...)`
 * check only ever proves half of that: it stays green if a name is silently
 * revoked, which is exactly the shape of bug it should also catch — revoking
 * `is_club_organizer` breaks `events_select_member` for every organizer, a
 * live outage a subset check would wave through. List every function
 * `authenticated` is SUPPOSED to reach; the reachable set must equal this
 * list exactly, in either direction. `reset_event_to_series` belongs in it —
 * Task 6 already grants it and asserts the positive case above.
 *
 * Compares by `p.oid::regprocedure`, not `p.proname`: a same-named overload
 * (e.g. a future `create_event()` alongside `create_event(uuid, ...)`) has a
 * different signature and so is not silently absorbed into the allowed set
 * the way a name-only comparison would absorb it. The expected list below is
 * cast through `::regprocedure::text` too, so both sides go through the same
 * canonicalization and a reader sees the actual mismatched signature in the
 * `is()` diff rather than a decoded name.
 */
select is(
  (select coalesce(
     array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),
     '{}')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  (select array_agg(x::regprocedure::text order by x::regprocedure::text)
   from unnest(array[
     'public.is_club_member(uuid)',
     'public.is_club_organizer(uuid)',
     'public.create_club(text, text)',
     'public.accept_club_invite(text)',
     'public.club_roster(uuid)',
     'public.create_venue(text, text, text, text, text, uuid, boolean)',
     'public.update_venue(uuid, text, text, text, text, text)',
     'public.archive_venue(uuid)',
     'public.search_venues(uuid, text)',
     'public.create_event(uuid, text, uuid, text, timestamptz, timestamptz, int)',
     'public.update_event(uuid, text, uuid, text, timestamptz, timestamptz)',
     'public.cancel_event(uuid)',
     'public.add_event_table(uuid)',
     'public.update_event_table(uuid, text, public.skill_tier)',
     'public.remove_event_table(uuid)',
     'public.create_event_series(uuid, text, uuid, text, public.series_frequency, smallint, smallint, time, int, int, date, date)',
     'public.update_event_series(uuid, text, uuid, text, time, int, int, date, boolean)',
     'public.end_event_series(uuid, boolean)',
     'public.reset_event_to_series(uuid)'
   ]) as x),
  'authenticated can execute exactly the expected set of functions'
);

select * from finish();
rollback;
