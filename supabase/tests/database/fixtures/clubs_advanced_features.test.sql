begin;
set local search_path to extensions, public;
select plan(7);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ad01', 'adv-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000ad02', 'adv-cohost@example.com'),
  ('cccccccc-0000-0000-0000-00000000ad03', 'adv-member@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ad01', 'Advanced Group', 'advanced-group',
   'aaaaaaaa-0000-0000-0000-00000000ad01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ad01',
   'aaaaaaaa-0000-0000-0000-00000000ad01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000ad01',
   'bbbbbbbb-0000-0000-0000-00000000ad02', 'co_organizer'),
  ('c1c1c1c1-0000-0000-0000-00000000ad01',
   'cccccccc-0000-0000-0000-00000000ad03', 'member');

select is(
  (select advanced_enabled from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-00000000ad01'),
  false,
  'a new group starts with Advanced off'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000ad03", "role": "authenticated"}';

select throws_ok(
  $$select public.set_club_advanced('c1c1c1c1-0000-0000-0000-00000000ad01', true)$$,
  '42501',
  null,
  'a plain member cannot turn Advanced on'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000ad01", "role": "authenticated"}';

select throws_ok(
  $$update public.clubs set advanced_enabled = true
    where id = 'c1c1c1c1-0000-0000-0000-00000000ad01'$$,
  '42501',
  null,
  'even the host cannot write the column directly'
);

select lives_ok(
  $$select public.set_club_advanced('c1c1c1c1-0000-0000-0000-00000000ad01', true)$$,
  'the host can turn Advanced on'
);

select is(
  (select advanced_enabled from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-00000000ad01'),
  true,
  'the flag was actually set'
);

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000ad02", "role": "authenticated"}';

select lives_ok(
  $$select public.set_club_advanced('c1c1c1c1-0000-0000-0000-00000000ad01', false)$$,
  'a co-host can turn it back off'
);

select is(
  (select advanced_enabled from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-00000000ad01'),
  false,
  'the flag was cleared'
);

select * from finish();
rollback;
