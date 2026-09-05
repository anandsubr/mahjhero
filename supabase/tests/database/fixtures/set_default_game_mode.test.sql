begin;
set local search_path to extensions, public;
select plan(4);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ed01', 'sd-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000ed02', 'sd-coorg@example.com'),
  ('cccccccc-0000-0000-0000-00000000ed03', 'sd-member@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ed01', 'Settings Club', 'settings-club',
   'aaaaaaaa-0000-0000-0000-00000000ed01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ed01',
   'aaaaaaaa-0000-0000-0000-00000000ed01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000ed01',
   'bbbbbbbb-0000-0000-0000-00000000ed02', 'co_organizer'),
  ('c1c1c1c1-0000-0000-0000-00000000ed01',
   'cccccccc-0000-0000-0000-00000000ed03', 'member');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000ed03", "role": "authenticated"}';

select throws_ok(
  $$select public.set_default_game_mode(
      'c1c1c1c1-0000-0000-0000-00000000ed01', 'invite_only')$$,
  '42501',
  null,
  'a plain member cannot change the club default'
);

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000ed02", "role": "authenticated"}';

select lives_ok(
  $$select public.set_default_game_mode(
      'c1c1c1c1-0000-0000-0000-00000000ed01', 'invite_only')$$,
  'a co-organizer can change the club default'
);

select is(
  (select default_game_mode::text from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-00000000ed01'),
  'invite_only',
  'the default was actually updated'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000ed01", "role": "authenticated"}';

select lives_ok(
  $$select public.set_default_game_mode(
      'c1c1c1c1-0000-0000-0000-00000000ed01', 'open_play')$$,
  'the host can change it back'
);

select * from finish();
rollback;
