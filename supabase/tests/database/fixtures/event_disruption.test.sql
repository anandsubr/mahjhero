begin;
set local search_path to extensions, public;

select plan(24);

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
-- A scalar subquery against a nonexistent row also reads NULL, so the
-- assertion above cannot by itself tell "nulled" from "deleted". Guard it.
select is(
  (select count(*)::int from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000001'),
  1,
  'and the booking row itself still exists, merely unplaced');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'unseated'
      and event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
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
-- IMPORTANT FIX (20260825100000): accepting a promotion offer used to be
-- able to seat a group past the event's capacity, because
-- accept_promotion_offer trusted the seat count stamped on the offer when
-- it was minted rather than checking capacity actually free at the moment
-- of acceptance. Tested here, in this file, because the way capacity
-- shrinks out from under an outstanding offer is exactly what
-- remove_event_table does (unseat, never destroy) -- the same mechanism
-- event_disruption.test.sql already exercises above for the "unseat
-- rather than eject" rule. waitlist_promotion.test.sql covers
-- promote_waitlist's own termination fix instead.
--
-- A second, isolated event: two tables of two (capacity 4). Alice and
-- Carol confirmed at Table A (full); Dan confirmed alone at Table B (one
-- free seat). Frank and Grace, an "any table" pair, are offered that one
-- free seat (offered_seat_count = 1; they still want 2). The host then
-- removes Table B -- Dan is unseated, not ejected, exactly as tested
-- above -- so capacity drops to 2 while 3 bookings stay confirmed and the
-- offer still holds 1: `cap 2, conf 3, held 1, free 0`. Frank accepts.
-- Before the fix: confirm_group_seats(group, 1) ignored capacity entirely
-- for an "any table" group (seat_assignments' `preferred is null` branch
-- never checks it -- see 20260825100000's header) and seated one more
-- booking anyway: `cap 2, conf 4`. After the fix: the seat count is
-- bounded by `least(offered_seat_count, event_free_seats(...))` = 0, so
-- nothing is seated and the pair stays exactly as waitlisted as before.
-- ---------------------------------------------------------------------
-- The preceding throws_ok block left role set to authenticated, which has
-- no direct DML grant on these tables -- only the security-definer
-- functions do.
reset role;

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Thursday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000010',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table A', 2, 1),
  ('7ab1e000-0000-0000-0000-000000000011',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table B', 2, 2);

-- Alice and Carol fill Table A.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000010',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000010');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by) values
  ('9909aaaa-0000-0000-0000-000000000010',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000010',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('9909aaaa-0000-0000-0000-000000000010',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000010',
   'cccccccc-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- Dan sits alone at Table B -- one free seat there.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000011',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   '7ab1e000-0000-0000-0000-000000000011');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by) values
  ('9909aaaa-0000-0000-0000-000000000011',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000011',
   'dddddddd-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000004');

-- Frank and Grace, any table, want two seats.
insert into public.booking_groups
  (id, event_id, club_id, created_by, allow_split, status, waitlisted_at)
  values
  ('9909aaaa-0000-0000-0000-000000000012',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000006', true, 'waitlisted', now());
insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000012',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '66666666-0000-0000-0000-000000000006',
   '66666666-0000-0000-0000-000000000006', 'waitlisted'),
  ('9909aaaa-0000-0000-0000-000000000012',
   'e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '77777777-0000-0000-0000-000000000007',
   '66666666-0000-0000-0000-000000000006', 'waitlisted');

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000002');

select is(
  (select offered_seat_count from public.promotion_offers
    where group_id = '9909aaaa-0000-0000-0000-000000000012'),
  1,
  'Frank and Grace are offered the one free seat at Table B');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.remove_event_table('7ab1e000-0000-0000-0000-000000000011')$$,
  'the host removes Table B out from under the outstanding offer');

reset role;

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000002'), 0,
  'cap 2, conf 3, held 1: no free seats left for the offer to spend');

-- The event is already over capacity at this point (Dan's confirmed
-- booking survived the table removal that unseated him -- the same
-- "unseat, never destroy" rule proven above, not this fix's concern). So
-- "confirmed <= capacity" does not hold even before the accept; what this
-- fix guards is that the accept does not make that WORSE. Captured here,
-- compared after.
create temporary table _confirmed_before_accept as
  select count(*)::int as n from public.bookings
  where event_id = 'e1e1e1e1-0000-0000-0000-000000000002'
    and status = 'confirmed';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "66666666-0000-0000-0000-000000000006", "role": "authenticated"}';

select is(
  public.accept_promotion_offer(
    (select id from public.promotion_offers
      where group_id = '9909aaaa-0000-0000-0000-000000000012')),
  0,
  'accepting seats nobody -- capacity for the promised seat evaporated first');

reset role;

select is(
  (select count(*)::int from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000002'
      and status = 'confirmed'),
  3,
  'confirmed count is unchanged by the accept');
select is(
  (select count(*)::int from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000002'
      and status = 'confirmed'),
  (select n from _confirmed_before_accept),
  'the accept does not seat anybody beyond what was already confirmed -- the property this fix exists to hold');
select is(
  (select count(*)::int from public.bookings
    where group_id = '9909aaaa-0000-0000-0000-000000000012'
      and status = 'waitlisted'),
  2,
  'Frank and Grace are still both waitlisted, exactly as before the accept');
select is(
  (select status::text from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000012'),
  'waitlisted',
  'and their group is still waitlisted, not confirmed');

-- ---------------------------------------------------------------------
-- Cancelling the game voids everything.
-- ---------------------------------------------------------------------
-- An offer outstanding on Ivy's group when the host cancels: it must be
-- expired, not left dangling forever with nothing left to answer. Direct
-- insert, so `reset role` first -- authenticated has no DML grant on
-- promotion_offers, only the security-definer functions do.
reset role;
insert into public.promotion_offers
  (id, group_id, event_id, offered_seat_count, expires_at) values
  ('0ffe0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001',
   1, now() + interval '2 hours');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

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
-- The assertion above only proves the rows are no longer confirmed or
-- waitlisted -- deleting them entirely would pass it just as well. The
-- rule is VOID, never destroy: check the rows are still there, explicitly
-- cancelled.
select is(
  (select count(*)::int from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and status = 'cancelled'),
  7,
  'and every one of those bookings is a cancelled record, not a gone one');
select is(
  (select count(distinct recipient_id)::int from public.notification_outbox
    where kind = 'event_cancelled'
      and event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  7,
  'and everybody who held or awaited a seat is told once');
-- "distinct" collapses duplicates -- it cannot tell "told once" from
-- "told several times, to the same seven people". Count the rows too.
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_cancelled'
      and event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  7,
  'and not one of them hears it twice');
select is(
  (select outcome::text from public.promotion_offers
    where id = '0ffe0000-0000-0000-0000-000000000001'),
  'expired',
  'an outstanding offer is expired along with the game, not left hanging');
select is(
  (select count(*)::int from public.booking_groups
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and status = 'cancelled'),
  5,
  'and every booking group carries the same cancelled status');

select * from finish();
rollback;
