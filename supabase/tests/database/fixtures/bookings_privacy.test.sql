begin;
set local search_path to extensions, public;
select plan(4);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000eb01', 'bk-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000eb02', 'bk-member@example.com'),
  ('cccccccc-0000-0000-0000-00000000eb03', 'bk-outsider@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000eb01', 'Bookings Privacy Club',
   'bookings-privacy-club', 'aaaaaaaa-0000-0000-0000-00000000eb01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000eb01',
   'aaaaaaaa-0000-0000-0000-00000000eb01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000eb01',
   'bbbbbbbb-0000-0000-0000-00000000eb02', 'member'),
  ('c1c1c1c1-0000-0000-0000-00000000eb01',
   'cccccccc-0000-0000-0000-00000000eb03', 'member');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000eb01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000eb01',
   'aaaaaaaa-0000-0000-0000-00000000eb01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, game_mode, created_by
) values (
  '22222222-0000-0000-0000-00000000eb01', 'c1c1c1c1-0000-0000-0000-00000000eb01',
  'Private Game', '11111111-0000-0000-0000-00000000eb01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only',
  'aaaaaaaa-0000-0000-0000-00000000eb01'
);

insert into public.booking_groups (id, event_id, club_id, created_by, status) values
  ('55555555-0000-0000-0000-00000000eb01', '22222222-0000-0000-0000-00000000eb01',
   'c1c1c1c1-0000-0000-0000-00000000eb01',
   'aaaaaaaa-0000-0000-0000-00000000eb01', 'confirmed');
insert into public.bookings (group_id, event_id, club_id, profile_id, booked_by) values
  ('55555555-0000-0000-0000-00000000eb01', '22222222-0000-0000-0000-00000000eb01',
   'c1c1c1c1-0000-0000-0000-00000000eb01',
   'bbbbbbbb-0000-0000-0000-00000000eb02',
   'aaaaaaaa-0000-0000-0000-00000000eb01');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000eb03", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000eb01'),
  0,
  'an uninvited member reads zero booking rows for a private event'
);

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000eb02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000eb01'),
  1,
  'a not-yet-placed invitee reads only their own booking row'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000eb01", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000eb01'),
  1,
  'the organizer reads the booking row too'
);

-- Open-play events are unaffected: a plain member sees every booking.
set local role postgres;
reset request.jwt.claims;
update public.events set game_mode = 'open_play'
where id = '22222222-0000-0000-0000-00000000eb01';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000eb03", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000eb01'),
  1,
  'open_play bookings are unaffected -- any club member reads every row'
);

select * from finish();
rollback;
