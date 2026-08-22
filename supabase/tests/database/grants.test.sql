begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(9);

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

select * from finish();
rollback;
