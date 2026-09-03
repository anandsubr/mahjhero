begin;
set local search_path to extensions, public;

select plan(36);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

-- Alice hosts. Everyone else is an ordinary member.
insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users;

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Last week',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '1 day', now() - interval '21 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 2, 1),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1);

-- Carol books herself and Dan. Two seats, table full.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   '7ab1e000-0000-0000-0000-000000000001');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values
  ('b00c0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003'),
  ('b00c0000-0000-0000-0000-000000000002',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'cccccccc-0000-0000-0000-000000000003');

-- Erin is waiting.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   '7ab1e000-0000-0000-0000-000000000001', 'waitlisted', now());

insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000005',
   '9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted');

-- Bob has a seat at last week's game, which is over.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000009',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   '7ab1e000-0000-0000-0000-000000000003');
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values ('b00c0000-0000-0000-0000-000000000009',
        '9909aaaa-0000-0000-0000-000000000009',
        'e3e3e3e3-0000-0000-0000-000000000003',
        'c1c1c1c1-0000-0000-0000-000000000001',
        '7ab1e000-0000-0000-0000-000000000003',
        'bbbbbbbb-0000-0000-0000-000000000002',
        'bbbbbbbb-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------
-- Who may end a booking.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$select public.cancel_booking('b00c0000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a caller with no sub claim cannot cancel a booking');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.cancel_booking('b00c0000-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'an unrelated member cannot cancel somebody else''s seat');

select throws_ok(
  $$select public.cancel_booking('b00c0000-0000-0000-0000-000000000009')$$,
  '23514',
  'event already started',
  'a seat at a game that has started cannot be given up');

-- Dan gives up his own seat. Erin is waiting, so she takes it in the same
-- transaction — this is the whole point of promoting inline.
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking('b00c0000-0000-0000-0000-000000000002')$$,
  'a member gives up their own seat');

reset role;
select is(
  (select cancelled_by from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000002'),
  'dddddddd-0000-0000-0000-000000000004'::uuid,
  'and the row records who ended it');
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000005'),
  'confirmed',
  'the member who was waiting is seated in the same transaction');
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000005'),
  '7ab1e000-0000-0000-0000-000000000001'::uuid,
  'at the table the seat came free at');

-- ---------------------------------------------------------------------
-- Declining a seat somebody else booked for you.
-- ---------------------------------------------------------------------
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000010',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003', 'waitlisted');

-- Alice books a seat for Carol at last week's (already-started) game, to
-- exercise decline_booking's "event already started" guard on a booking
-- Carol may legitimately decline (booked_by <> profile_id, so it does not
-- trip the earlier "nothing to decline" guard instead).
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003');
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by) values
  ('b00c0000-0000-0000-0000-000000000022',
   '9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.decline_booking('b00c0000-0000-0000-0000-000000000010')$$,
  'the person a seat was booked for may decline it');

reset role;
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000010'),
  'declined',
  'a declined seat is declined, not cancelled — the booker is owed the difference');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_declined'
      and recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  1,
  'and the booker is told');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.decline_booking('b00c0000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a seat you booked yourself is cancelled, never declined');

select throws_ok(
  $$select public.decline_booking('b00c0000-0000-0000-0000-000000000022')$$,
  '23514',
  'event already started',
  'a seat at a game that has started cannot be declined');

-- ---------------------------------------------------------------------
-- The host may end anybody's booking, and the member hears about it.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking('b00c0000-0000-0000-0000-000000000005')$$,
  'an organizer may end any booking in their club''s game');

reset role;
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_cancelled_by_host'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'and the member whose seat it was is told');

-- ---------------------------------------------------------------------
-- Group rollup, and leaving the waitlist as a group.
-- ---------------------------------------------------------------------
select is(
  (select status::text from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000002'),
  'cancelled',
  'a group whose last live booking ends is itself cancelled');

-- booking_result must read the cancelled group back as outcome 'cancelled',
-- not 'seated' or 'waitlisted' — Task 8's data layer depends on this.
select is(
  (public.booking_result('9909aaaa-0000-0000-0000-000000000002')->>'outcome'),
  'cancelled',
  'and booking_result reports a fully-cancelled group as "cancelled"');

insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   '7ab1e000-0000-0000-0000-000000000001', 'waitlisted', now());
insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted'),
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted');
insert into public.promotion_offers
  (id, group_id, event_id, offered_seat_count, expires_at) values
  ('0ffe0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001', 1, now() + interval '2 hours');

set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$select public.cancel_booking_group('9909aaaa-0000-0000-0000-000000000003')$$,
  '42501',
  null,
  'a caller with no sub claim cannot cancel a booking group');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.cancel_booking_group('9909aaaa-0000-0000-0000-000000000009')$$,
  '23514',
  'event already started',
  'a group at a game that has started cannot be withdrawn');

set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking_group(
      '9909aaaa-0000-0000-0000-000000000003')$$,
  'the booker may withdraw the whole group from the waitlist');

reset role;
select is(
  (select count(*)::int from public.bookings
    where group_id = '9909aaaa-0000-0000-0000-000000000003'
      and status in ('confirmed', 'waitlisted')),
  0,
  'every booking in the group is closed');
select is(
  (select outcome::text from public.promotion_offers
    where id = '0ffe0000-0000-0000-0000-000000000001'),
  'declined',
  'and the offer it was holding seats with is resolved, not left outstanding');

-- ---------------------------------------------------------------------
-- Placement.
-- ---------------------------------------------------------------------

-- Table 1 (capacity 2) currently seats only Carol (confirmed): Dan gave up
-- his seat, Erin was promoted into it and then had that booking cancelled
-- by the host above, so Erin's group closed without ever re-occupying the
-- second chair. One seat is free at Table 1 going into this section.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004', null);
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by) values
  ('b00c0000-0000-0000-0000-000000000020',
   '9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000004');

set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000020', null)$$,
  '42501',
  null,
  'a caller with no sub claim cannot place a booking');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000009', null)$$,
  '23514',
  'this game has already ended',
  'a booking at a game that has ended cannot be placed');

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000020',
      '7ab1e000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'an ordinary member cannot move somebody else');

set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000020',
      '7ab1e000-0000-0000-0000-000000000001')$$,
  'a member may seat their own "any table" booking');

-- Table 1 is now full (Carol + Dan). A second, still-unplaced booking
-- trying to squeeze into it is the actual "table full" case — retrying the
-- same booking into the table it already occupies is a no-op, not a
-- capacity request, and must not be confused with one.
reset role;
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', null);
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by) values
  ('b00c0000-0000-0000-0000-000000000021',
   '9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000021',
      '7ab1e000-0000-0000-0000-000000000001')$$,
  '23514',
  'table full',
  'and cannot squeeze into a table that is already full');

set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000020', null)$$,
  'passing no table returns the booking to "any table"');

reset role;
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000020'),
  null::uuid,
  'and the booking''s table is actually cleared, not left as-is');

-- An organizer may place a booking that is not their own — the guard is
-- `profile_id = auth.uid() or is_club_organizer(...)`, not just the first
-- half.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000020',
      '7ab1e000-0000-0000-0000-000000000001')$$,
  'an organizer may place another member''s booking');

-- ---------------------------------------------------------------------
-- Placement during a live game (started, not yet ended). This is the
-- exact case that was broken: an "any table" confirmed booking, or an
-- already-seated one wanting to move, had no way to ever be placed once
-- starts_at passed -- forever, for the rest of the game.
-- ---------------------------------------------------------------------
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Right now',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000004',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000005',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 4, 2);

-- Carol is already seated at Table 1 (to exercise a table-to-table move).
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000010',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   '7ab1e000-0000-0000-0000-000000000004');
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by) values
  ('b00c0000-0000-0000-0000-000000000030',
   '9909aaaa-0000-0000-0000-000000000010',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000004',
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003');

-- Dan is confirmed but unplaced ("any table") -- the exact bug scenario.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000011',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004', null);
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by) values
  ('b00c0000-0000-0000-0000-000000000031',
   '9909aaaa-0000-0000-0000-000000000011',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000004');

-- Erin is waiting -- to prove a live-game move does NOT promote her.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000012',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   null, 'waitlisted', now());
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000032',
   '9909aaaa-0000-0000-0000-000000000012',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000031',
      '7ab1e000-0000-0000-0000-000000000004')$$,
  'an unplaced confirmed booking can be seated on a game that has already started');

reset role;
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000031'),
  '7ab1e000-0000-0000-0000-000000000004'::uuid,
  'and the table is actually recorded');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000030',
      '7ab1e000-0000-0000-0000-000000000005')$$,
  'an already-seated member can move to a different table on a live game');

reset role;
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000030'),
  '7ab1e000-0000-0000-0000-000000000005'::uuid,
  'and their booking now shows the new table');
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000032'),
  'waitlisted',
  'the seat Carol''s move freed at Table 1 does not promote the waitlisted group -- promote_waitlist''s own starts_at guard holds');

-- An organizer may also move somebody else's booking on a live game --
-- the same permission split place_booking already has, now unblocked by
-- time.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000031',
      '7ab1e000-0000-0000-0000-000000000005')$$,
  'an organizer may move another member''s booking on a live game');

reset role;
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000031'),
  '7ab1e000-0000-0000-0000-000000000005'::uuid,
  'and that move is recorded too');

select * from finish();
rollback;
