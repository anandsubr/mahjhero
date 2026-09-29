begin;
set local search_path to extensions, public;

select plan(21);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'host@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'joiner@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'removed@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'spammer@example.com');

-- A fixture insert with no code gets one from the trigger (existing fixture
-- files all insert clubs this way, so this is what keeps them working).
insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside Mah Jongg', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

select matches(
  (select code from public.clubs where id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  '^RIVERSID[0-9]{3}$',
  'a club inserted without a code gets name letters + 3 digits'
);

-- Captured now (as superuser, before any role switch) because the removed
-- member added below cannot see this club under clubs_select_member RLS
-- (is_club_member requires status = 'active'), so a same-role subquery for
-- the code later would silently see NULL instead of the real code.
select code as riverside_code from public.clubs
  where id = 'c1c1c1c1-0000-0000-0000-000000000001' \gset

select throws_ok(
  $$insert into public.clubs (name, slug, timezone, created_by, code) values
    ('Bad', 'bad', 'UTC', 'aaaaaaaa-0000-0000-0000-000000000001', 'AB')$$,
  '23514', null, 'a code shorter than 4 characters is refused'
);

insert into public.clubs (id, name, slug, timezone, created_by, code) values
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield', 'UTC',
   'aaaaaaaa-0000-0000-0000-000000000001', 'oak tiles');

select is(
  (select code from public.clubs where id = 'c2c2c2c2-0000-0000-0000-000000000002'),
  'OAKTILES',
  'an explicit code is uppercased and has its spaces removed'
);

select throws_ok(
  $$insert into public.clubs (name, slug, timezone, created_by, code) values
    ('Other', 'other', 'UTC', 'aaaaaaaa-0000-0000-0000-000000000001', 'OakTiles')$$,
  '23505', null, 'codes are unique regardless of the case they were typed in'
);

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 'member', 'removed'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active');

-- create_club with and without a code
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.create_club('North Side', '', 'north side')$$,
  'create_club accepts a code'
);
select is(
  (select code from public.clubs where name = 'North Side'),
  'NORTHSIDE',
  'create_club stores the normalized code'
);
select lives_ok(
  $$select public.create_club('Friday Tiles', '')$$,
  'create_club without a code still works'
);
select matches(
  (select code from public.clubs where name = 'Friday Tiles'),
  '^FRIDAYTI[0-9]{3}$',
  'create_club without a code generates one'
);
select throws_ok(
  $$select public.create_club('Dupe', '', 'OAKTILES')$$,
  '23505', null, 'create_club refuses a taken code'
);

-- set_club_code
select is(
  public.set_club_code('c2c2c2c2-0000-0000-0000-000000000002', ' oak 2 '),
  'OAK2',
  'a host can change the code; it comes back normalized'
);
select throws_ok(
  $$select public.set_club_code('c2c2c2c2-0000-0000-0000-000000000002', 'NORTHSIDE')$$,
  '23505', null, 'set_club_code refuses a code another club has'
);
select throws_ok(
  $$select public.set_club_code('c2c2c2c2-0000-0000-0000-000000000002', 'no!')$$,
  '22023', 'invalid_code', 'set_club_code refuses a malformed code'
);

-- join_club_by_code
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.set_club_code('c2c2c2c2-0000-0000-0000-000000000002', 'MINE')$$,
  '42501', null, 'a non-organizer cannot change the code'
);
select is(
  public.join_club_by_code('nope9999'),
  null,
  'an unknown code returns null'
);
select is(
  public.join_club_by_code(' oak2 ') ->> 'already_member',
  'false',
  'a valid code joins the club (case/space-insensitive)'
);
select is(
  (select role::text from public.club_members
    where club_id = 'c2c2c2c2-0000-0000-0000-000000000002'
      and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002' and status = 'active'),
  'member',
  'the joiner is an active member'
);
select is(
  public.join_club_by_code('OAK2') ->> 'already_member',
  'true',
  'joining again reports already_member'
);

set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';
select throws_ok(
  format('select public.join_club_by_code(%L)', :'riverside_code'),
  'P0001', 'removed_member', 'a removed member cannot rejoin by code'
);

-- rate limit: 10 attempts per hour, the 11th is refused
set local request.jwt.claims = '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';
select public.join_club_by_code('GUESS' || n) from generate_series(1, 10) n;
select throws_ok(
  $$select public.join_club_by_code('GUESS11')$$,
  'P0001', 'rate_limited', 'the 11th attempt in an hour is refused'
);

reset role;
select is(
  (select count(*)::int from public.club_code_attempts
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  10,
  'refused attempts are not recorded'
);

set local role anon;
select throws_ok(
  $$select public.join_club_by_code('OAK2')$$,
  '42501', null, 'anon cannot call join_club_by_code'
);
reset role;

select * from finish();
rollback;
