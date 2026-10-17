begin;
set local search_path to extensions, public;

select plan(12);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'me@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'other@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'outsider@example.com');

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

-- e1: no booking, 'not'. e2: confirmed at Table 1, 'going'. e3: waitlisted,
-- 'waitlisted'. e4: unanswered invite, 'invited'. e5: I created it, 'hosting'.
-- e6: invite-only, I have no part in it -> absent. e7: invite-only, I'm
-- booked -> present. e8: cancelled, I was booked -> absent. e9: another
-- club's game -> absent. e10: at exactly `to` -> excluded by the window.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by, status, seating_mode, capacity)
values
  ('e1000000-0000-0000-0000-000000000001', 'c1c1c1c1-0000-0000-0000-000000000001', 'No booking',
   '11111111-0000-0000-0000-000000000001', now() + interval '1 day', now() + interval '1 day 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'assigned_tables', null),
  ('e2000000-0000-0000-0000-000000000002', 'c1c1c1c1-0000-0000-0000-000000000001', 'Confirmed',
   '11111111-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'assigned_tables', null),
  ('e3000000-0000-0000-0000-000000000003', 'c1c1c1c1-0000-0000-0000-000000000001', 'Waitlisted',
   '11111111-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '3 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', 1),
  ('e4000000-0000-0000-0000-000000000004', 'c1c1c1c1-0000-0000-0000-000000000001', 'Invited',
   '11111111-0000-0000-0000-000000000001', now() + interval '4 days', now() + interval '4 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null),
  ('e5000000-0000-0000-0000-000000000005', 'c1c1c1c1-0000-0000-0000-000000000001', 'Hosting',
   '11111111-0000-0000-0000-000000000001', now() + interval '5 days', now() + interval '5 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001', 'published', 'open_seating', null),
  ('e8000000-0000-0000-0000-000000000008', 'c1c1c1c1-0000-0000-0000-000000000001', 'Cancelled',
   '11111111-0000-0000-0000-000000000001', now() + interval '6 days', now() + interval '6 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'cancelled', 'open_seating', null),
  ('e9000000-0000-0000-0000-000000000009', 'c2c2c2c2-0000-0000-0000-000000000002', 'Other club',
   '11111111-0000-0000-0000-000000000002', now() + interval '1 day', now() + interval '1 day 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null),
  ('ea000000-0000-0000-0000-00000000000a', 'c1c1c1c1-0000-0000-0000-000000000001', 'At the edge',
   '11111111-0000-0000-0000-000000000001', now() + interval '10 days', now() + interval '10 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null);

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by, status, seating_mode, capacity)
values
  ('eb000000-0000-0000-0000-00000000000b', 'c1c1c1c1-0000-0000-0000-000000000001', 'Notes',
   '11111111-0000-0000-0000-000000000001', now() + interval '7 days', now() + interval '7 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null);

update public.events set notes = 'Bring a card'
  where id = 'eb000000-0000-0000-0000-00000000000b';

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by, status, seating_mode, capacity, game_mode)
values
  ('e6000000-0000-0000-0000-000000000006', 'c1c1c1c1-0000-0000-0000-000000000001', 'Secret not mine',
   '11111111-0000-0000-0000-000000000001', now() + interval '8 days', now() + interval '8 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null, 'invite_only'),
  ('e7000000-0000-0000-0000-000000000007', 'c1c1c1c1-0000-0000-0000-000000000001', 'Secret mine',
   '11111111-0000-0000-0000-000000000001', now() + interval '9 days', now() + interval '9 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002', 'published', 'open_seating', null, 'invite_only');

insert into public.event_tables (id, event_id, club_id, label, capacity, position) values
  ('7a000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1);

insert into public.booking_groups (id, event_id, club_id, created_by, status, waitlisted_at) values
  ('99000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'waitlisted', now()),
  ('99000000-0000-0000-0000-000000000004', 'e4000000-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000007', 'e7000000-0000-0000-0000-000000000007',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000008', 'e8000000-0000-0000-0000-000000000008',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null);

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by, status, invite_holds_seat)
values
  ('99000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', '7a000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'waitlisted', null),
  ('99000000-0000-0000-0000-000000000004', 'e4000000-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true),
  ('99000000-0000-0000-0000-000000000007', 'e7000000-0000-0000-0000-000000000007',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-000000000008', 'e8000000-0000-0000-0000-000000000008',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null);

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select my_status from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'No booking'),
  'not', 'no booking is not'
);
select is(
  (select my_status || '/' || table_label from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'Confirmed'),
  'going/Table 1', 'a confirmed booking is going, with the table label'
);
select is(
  (select my_status || '/' || waitlist_position::text from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'Waitlisted'),
  'waitlisted/1', 'a waitlisted booking is waitlisted with position 1'
);
select is(
  (select my_status from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'Invited'),
  'invited', 'an unanswered invite is invited'
);
select is(
  (select my_status from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'Hosting'),
  'hosting', 'a game I created is hosting'
);
select is(
  (select count(*)::int from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'Secret not mine'),
  0, 'an invite-only game I do not organize or hold a booking on is absent'
);
select is(
  (select my_status from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'Secret mine'),
  'going', 'an invite-only game I am booked on is present'
);
select is(
  (select count(*)::int from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'Cancelled'),
  0, 'a cancelled game is absent'
);
select is(
  (select count(*)::int from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'Other club'),
  0, 'a game in another club is absent'
);
select is(
  (select count(*)::int from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '10 days')
   where title = 'At the edge'),
  0, 'the window is [from, to) -- a game starting exactly at to is excluded'
);
select is(
  (select notes from public.club_games(
    'c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '120 days')
   where title = 'Notes'),
  'Bring a card', 'notes comes through'
);

reset role;

insert into public.club_members (club_id, profile_id, role) values
  ('c2c2c2c2-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'member');

set local role authenticated;
set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';
select throws_ok(
  $$select * from public.club_games('c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '1 day')$$,
  '42501', null, 'a non-member of the target club cannot call club_games'
);
reset role;

select * from finish();
rollback;
