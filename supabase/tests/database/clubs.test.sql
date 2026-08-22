begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(9);

-- Structure
select has_table('public', 'clubs', 'clubs table exists');
select has_table('public', 'club_members', 'club_members table exists');
select has_table('public', 'club_invites', 'club_invites table exists');

-- Two members, two clubs. Alice hosts Riverside; Bob hosts Oakfield.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside Mah Jongg', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield Tiles', 'oakfield',
   'public', 'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host');

-- RLS: a member sees their own club and not the other one.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  1,
  'a member can read their own club'
);

select is(
  (select count(*)::int from public.clubs
   where id = 'c2c2c2c2-0000-0000-0000-000000000002'),
  0,
  'a member cannot read a club they do not belong to'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c2c2c2c2-0000-0000-0000-000000000002'),
  0,
  'a member cannot read another club roster'
);

-- The widened profiles policy: co-members are visible, strangers are not.
select is(
  (select count(*)::int from public.profiles
   where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'a member can still read their own profile'
);

select is(
  (select count(*)::int from public.profiles
   where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'a member cannot read the profile of someone in no shared club'
);

-- A member may not promote themselves.
select throws_ok(
  $$update public.club_members set role = 'host'
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
      and profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'a member cannot change roles directly'
);

select * from finish();
rollback;
