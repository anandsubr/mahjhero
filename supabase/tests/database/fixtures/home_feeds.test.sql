begin;
set local search_path to extensions, public;

select plan(12);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'me@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'other@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Mine', 'mine', 'America/New_York',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Not mine', 'not-mine', 'UTC',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'member'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('11111111-0000-0000-0000-000000000002', 'Elsewhere',
   'c2c2c2c2-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002');

-- e1: I'm confirmed at Table 1. e2: I'm waitlisted. e3: I created it (and
-- I'm booked too). e4: I'm only invited. e5: nothing to do with me. e6: in a
-- club I'm not in. e7: cancelled, I was booked. e8: next club game, far out.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by, status, seating_mode, capacity)
values
  ('e1000000-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'Thursday',
   '11111111-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '1 day 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'assigned_tables', null),
  ('e2000000-0000-0000-0000-000000000002', 'c1c1c1c1-0000-0000-0000-000000000001', 'Full one',
   '11111111-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', 1),
  ('e3000000-0000-0000-0000-000000000003', 'c1c1c1c1-0000-0000-0000-000000000001', 'My night',
   '11111111-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001', 'published', 'open_seating', null),
  ('e4000000-0000-0000-0000-000000000004', 'c1c1c1c1-0000-0000-0000-000000000001', 'Invited',
   '11111111-0000-0000-0000-000000000001', now() + interval '4 days', now() + interval '4 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null),
  ('e5000000-0000-0000-0000-000000000005', 'c1c1c1c1-0000-0000-0000-000000000001', 'Not joined',
   '11111111-0000-0000-0000-000000000001', now() + interval '5 days', now() + interval '5 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null),
  ('e6000000-0000-0000-0000-000000000006', 'c2c2c2c2-0000-0000-0000-000000000002', 'Other club',
   '11111111-0000-0000-0000-000000000002', now() + interval '1 day', now() + interval '1 day 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null),
  ('e7000000-0000-0000-0000-000000000007', 'c1c1c1c1-0000-0000-0000-000000000001', 'Cancelled',
   '11111111-0000-0000-0000-000000000001', now() + interval '6 days', now() + interval '6 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'cancelled', 'open_seating', null),
  ('e8000000-0000-0000-0000-000000000008', 'c2c2c2c2-0000-0000-0000-000000000002', 'Far',
   '11111111-0000-0000-0000-000000000002', now() + interval '200 days', now() + interval '200 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null);

insert into public.event_tables (id, event_id, club_id, label, capacity, position) values
  ('7a000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1);

insert into public.booking_groups (id, event_id, club_id, created_by, status, waitlisted_at) values
  ('99000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'waitlisted', now()),
  ('99000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000004', 'e4000000-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000007', 'e7000000-0000-0000-0000-000000000007',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null);

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by, status, invite_holds_seat)
values
  ('99000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'waitlisted', null),
  ('99000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000004', 'e4000000-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true),
  ('99000000-0000-0000-0000-000000000007', 'e7000000-0000-0000-0000-000000000007',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null);

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select array_agg(title order by starts_at) from public.my_games(now(), now() + interval '120 days')),
  array['Thursday', 'Full one', 'My night'],
  'my_games lists confirmed, waitlisted and created games only (no invited, unjoined, other-club or cancelled)'
);
select is(
  (select my_status from public.my_games(now(), now() + interval '120 days') where title = 'Thursday'),
  'going', 'a confirmed booking is going'
);
select is(
  (select table_label from public.my_games(now(), now() + interval '120 days') where title = 'Thursday'),
  'Table 1', 'the table label comes through'
);
select is(
  (select seats_taken || '/' || capacity from public.my_games(now(), now() + interval '120 days') where title = 'Thursday'),
  '1/4', 'seats taken over capacity'
);
select is(
  (select my_status from public.my_games(now(), now() + interval '120 days') where title = 'Full one'),
  'waitlisted', 'a waitlisted booking is waitlisted'
);
select is(
  (select waitlist_position from public.my_games(now(), now() + interval '120 days') where title = 'Full one'),
  1, 'waitlist position is reported'
);
select is(
  (select my_status from public.my_games(now(), now() + interval '120 days') where title = 'My night'),
  'hosting', 'a game I created is hosting even though I am booked'
);
select is(
  (select capped from public.my_games(now(), now() + interval '120 days') where title = 'My night'),
  false, 'an open-seating game with no capacity is uncapped'
);
select is(
  (select count(*)::int from public.my_games(now() + interval '2 days', now() + interval '3 days')),
  1, 'the window is [from, to)'
);
select is(
  (select array_agg(club_id::text) from public.my_clubs_next_game()),
  array['c1c1c1c1-0000-0000-0000-000000000001'],
  'my_clubs_next_game covers only my clubs'
);
select ok(
  (select next_starts_at from public.my_clubs_next_game()) < now() + interval '1 day 1 minute',
  'next game is the soonest published one'
);

set local role anon;
select throws_ok($$select * from public.my_games(now(), now() + interval '1 day')$$,
  '42501', null, 'anon cannot call my_games');
reset role;

select * from finish();
rollback;
