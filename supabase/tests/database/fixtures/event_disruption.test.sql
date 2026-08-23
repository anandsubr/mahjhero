begin;
set local search_path to extensions, public;

select plan(11);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),
  -- Frank, Grace and Henry exist only to make the event genuinely
  -- over-subscribed later (see the note above the free-seats assertion
  -- below): the brief's own fixture, as written, cannot reach a negative
  -- raw seat count at that point, because the table added in this test's
  -- first block always carries the schema's default capacity of 4.
  ('66666666-0000-0000-0000-000000000006', 'frank@example.com'),
  ('77777777-0000-0000-0000-000000000007', 'grace@example.com'),
  ('88888888-0000-0000-0000-000000000008', 'henry@example.com'),
  -- Ivy stays on the waitlist for the entire file: the game is
  -- over-subscribed the moment she is inserted and never becomes less so
  -- (see below), so promote_waitlist never reaches her. Without a booking
  -- that is still 'waitlisted' when cancel_event runs, the mutation-check
  -- "notify confirmed and waitlisted alike" (Step 6 of the task brief)
  -- cannot fail: the brief's own fixture, run verbatim, has already
  -- promoted its one waitlisted booking (Erin) to confirmed by the time
  -- cancel_event is called, despite its Step 6 comment assuming otherwise.
  ('99999999-0000-0000-0000-000000000009', 'ivy@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

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
   'aaaaaaaa-0000-0000-0000-000000000001');

-- Two tables of one seat each. Carol sits at Table 2, Dan at Table 1,
-- Erin waits.
insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 1, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 1, 2);

insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   '7ab1e000-0000-0000-0000-000000000002'),
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   '7ab1e000-0000-0000-0000-000000000001');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values
  ('b00c0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003'),
  ('b00c0000-0000-0000-0000-000000000002',
   '9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000004');

insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005', null, 'waitlisted', now());
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000003',
   '9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted');

-- Frank, Grace and Henry: three more confirmed, unplaced ("any table")
-- bookings, present from the start. See the note by the auth.users insert
-- above — without them, capacity never actually drops below the confirmed
-- count later in this file, and the over-subscription assertion would be
-- testing a scenario that cannot occur.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000006', null);
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by) values
  ('b00c0000-0000-0000-0000-000000000004',
   '9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000006',
   '66666666-0000-0000-0000-000000000006'),
  ('b00c0000-0000-0000-0000-000000000005',
   '9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '77777777-0000-0000-0000-000000000007',
   '77777777-0000-0000-0000-000000000007'),
  ('b00c0000-0000-0000-0000-000000000006',
   '9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '88888888-0000-0000-0000-000000000008',
   '88888888-0000-0000-0000-000000000008');

-- Ivy: waitlisted, and stays that way. Group id sorts after Erin's
-- (...0003 < ...0005), so when promote_waitlist ties both on waitlisted_at
-- and created_at (both default to the same transaction-start now(), per
-- this project's usual trap), Erin is considered first and Ivy second —
-- deterministically, not by luck.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000009', null, 'waitlisted', now());
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000007',
   '9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000009',
   '99999999-0000-0000-0000-000000000009', 'waitlisted');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- Adding a table makes room, and the room is used immediately.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.add_event_table('e1e1e1e1-0000-0000-0000-000000000001')$$,
  'an organizer adds a third table');

reset role;
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000003'),
  'confirmed',
  'and the member who was waiting is seated in that same transaction');

-- ---------------------------------------------------------------------
-- Removing a table unseats rather than ejects.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.remove_event_table('7ab1e000-0000-0000-0000-000000000002')$$,
  'a table with somebody sitting at it can still be removed');

reset role;
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000001'),
  'confirmed',
  'the member keeps their place in the game');
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000001'),
  null,
  'and becomes an "any table" booking for the host to place');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'unseated'
      and recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  1,
  'and is told they need seating');

-- Capacity is now five (Table 1's one seat plus Table 3's default four).
-- Six bookings are confirmed (Dan, Carol, Erin, Frank, Grace, Henry) — one
-- more than capacity, so the raw count is negative and free seats must
-- floor at zero rather than reporting it.
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'an over-subscribed game reports no free seats, not negative ones');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.remove_event_table('7ab1e000-0000-0000-0000-000000000001');
    select public.remove_event_table(
      (select id from public.event_tables
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
        limit 1))$$,
  '23514',
  null,
  'the last table still cannot be removed');

-- ---------------------------------------------------------------------
-- Cancelling the game voids everything.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.cancel_event('e1e1e1e1-0000-0000-0000-000000000001')$$,
  'an organizer cancels the game');

reset role;
select is(
  (select count(*)::int from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and status in ('confirmed', 'waitlisted')),
  0,
  'no booking survives a cancelled game');
select is(
  (select count(distinct recipient_id)::int from public.notification_outbox
    where kind = 'event_cancelled'),
  7,
  'and everybody who held or awaited a seat is told once');

select * from finish();
rollback;
