begin;
set local search_path to extensions, public;

select plan(11);

-- Alice and Bob share Riverside. Alice and Carol share Oakfield. Bob and
-- Carol share nothing. Dave is in no club.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dave@example.com');

update public.profiles set display_name = 'Alice Ng'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Bob Reyes'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set display_name = 'Carol Diaz'
 where id = 'cccccccc-0000-0000-0000-000000000003';

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside Mah Jongg', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield Tiles', 'oakfield',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003', 'member', 'active');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- Acquiring a friend requires a shared active club, and nothing else.
select lives_ok(
  $$select public.add_friend('bbbbbbbb-0000-0000-0000-000000000002')$$,
  'a club-mate can be added'
);
select throws_ok(
  $$select public.add_friend('dddddddd-0000-0000-0000-000000000004')$$,
  '42501',
  null,
  'somebody you share no club with cannot be added'
);
select throws_ok(
  $$select public.add_friend('aaaaaaaa-0000-0000-0000-000000000001')$$,
  '22023',
  null,
  'you cannot add yourself'
);
select lives_ok(
  $$select public.add_friend('bbbbbbbb-0000-0000-0000-000000000002')$$,
  'adding an existing friend is a no-op, not an error'
);
select is(
  (select count(*)::int from public.friendships),
  1,
  'and it did not write a second edge'
);

-- fetch_friends carries the clubs the two of you still share.
select is(
  (select club_names from public.fetch_friends()
    where profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  array['Riverside Mah Jongg'],
  'a friend lists the clubs you still share'
);

-- The friendship outlives the club. This is the whole cross-club story.
-- club_members has no update grant for authenticated (see
-- 20260822041836_revoke_blanket_table_grants.sql) — direct fixture writes
-- step outside the role for the statement, same as friendships.test.sql
-- and broadcasts.test.sql do.
reset role;
update public.club_members set status = 'removed'
 where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
   and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002';
set local role authenticated;

select is(
  (select count(*)::int from public.fetch_friends()),
  1,
  'leaving the shared club does not end the friendship'
);
select is(
  (select club_names from public.fetch_friends()
    where profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  '{}'::text[],
  'but the shared-club list is then empty'
);

-- fetch_addable_people: club-mates who are not already friends, never you.
select results_eq(
  $$select display_name from public.fetch_addable_people()$$,
  $$values ('Carol Diaz'::text)$$,
  'offers the club-mate who is not yet a friend, and not you or an existing friend'
);

-- Removing.
select lives_ok(
  $$select public.remove_friend('bbbbbbbb-0000-0000-0000-000000000002')$$,
  'a friend can be removed'
);
select is(
  (select count(*)::int from public.fetch_friends()),
  0,
  'and is gone'
);

select * from finish();
rollback;
