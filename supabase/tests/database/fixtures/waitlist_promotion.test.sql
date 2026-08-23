begin;
set local search_path to extensions, public;

select plan(32);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),
  ('ffffffff-0000-0000-0000-000000000006', 'fred@example.com');

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

-- One game, one table of four, starting in a week.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1);

-- Alice, Bob, Carol and Dan hold all four seats.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001');

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
select '9909aaaa-0000-0000-0000-000000000001',
       'e1e1e1e1-0000-0000-0000-000000000001',
       'c1c1c1c1-0000-0000-0000-000000000001',
       '7ab1e000-0000-0000-0000-000000000001', u.id, u.id
from auth.users u
where u.id in ('aaaaaaaa-0000-0000-0000-000000000001',
               'bbbbbbbb-0000-0000-0000-000000000002',
               'cccccccc-0000-0000-0000-000000000003',
               'dddddddd-0000-0000-0000-000000000004');

-- Erin waits alone; Fred waits alone, later. created_at is set explicitly
-- and DELIBERATELY out of step with waitlisted_at (Erin's row is "created"
-- earlier than Fred's, in the opposite order from when each actually
-- joined the queue). The whole fixture runs inside one transaction, so an
-- unset created_at default would tie every row to the same
-- transaction-start now() and silently make any `order by created_at`
-- ordering indistinguishable from insertion order — which is exactly the
-- gap that let `order by waitlisted_at` -> `order by created_at desc`
-- pass this suite undetected before this column was pinned by hand.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at, created_at) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   '7ab1e000-0000-0000-0000-000000000001', 'waitlisted',
   now() - interval '2 hours', now() - interval '3 hours'),
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   '7ab1e000-0000-0000-0000-000000000001', 'waitlisted',
   now() - interval '1 hour', now() - interval '10 minutes');

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'eeeeeeee-0000-0000-0000-000000000005',
   'eeeeeeee-0000-0000-0000-000000000005', 'waitlisted'),
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   'ffffffff-0000-0000-0000-000000000006', 'waitlisted');

-- ---------------------------------------------------------------------
-- seat_assignments: the single placement rule.
-- ---------------------------------------------------------------------
select is_empty(
  $$select * from public.seat_assignments(
      'e1e1e1e1-0000-0000-0000-000000000001', 1,
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'a full table yields no assignment');

select results_eq(
  $$select event_table_id, seats from public.seat_assignments(
      'e1e1e1e1-0000-0000-0000-000000000001', 2, null, true)$$,
  $$values (null::uuid, 2)$$,
  'a null preferred table means "any table" — unplaced, whatever the split flag');

-- ---------------------------------------------------------------------
-- Nothing free: the walk does nothing at all.
-- ---------------------------------------------------------------------
select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select status::text from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000002'),
  'waitlisted',
  'a full game promotes nobody');
select is(
  (select count(*)::int from public.promotion_offers), 0,
  'and offers nothing');

-- ---------------------------------------------------------------------
-- One seat frees. Erin waited first, so Erin gets it.
-- ---------------------------------------------------------------------
update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = 'dddddddd-0000-0000-0000-000000000004'
 where profile_id = 'dddddddd-0000-0000-0000-000000000004';

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select status::text from public.bookings
    where profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  'confirmed',
  'the group that waited longest is promoted first');
select is(
  (select event_table_id from public.bookings
    where profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  '7ab1e000-0000-0000-0000-000000000001'::uuid,
  'and is placed at the table it asked for');
select is(
  (select status::text from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000002'),
  'confirmed',
  'a group with no waitlisted bookings left is confirmed');
select is(
  (select waitlisted_at from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000002'),
  null,
  'and its waitlisted_at is cleared');
select is(
  (select status::text from public.bookings
    where profile_id = 'ffffffff-0000-0000-0000-000000000006'),
  'waitlisted',
  'the second group waits its turn');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'waitlist_promoted'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'promotion writes one outbox row for the promoted member');

-- ---------------------------------------------------------------------
-- A group too big for the seats available, splitting allowed: an offer,
-- and the seats it names are held against everybody else.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, allow_split,
   status, waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   '7ab1e000-0000-0000-0000-000000000001', false, 'waitlisted',
   now() - interval '30 minutes');

-- Fred's solo group is withdrawn so the "too big" group is next in line.
update public.booking_groups set status = 'cancelled', waitlisted_at = null
 where id = '9909aaaa-0000-0000-0000-000000000003';
update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = 'ffffffff-0000-0000-0000-000000000006'
 where group_id = '9909aaaa-0000-0000-0000-000000000003';

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   'ffffffff-0000-0000-0000-000000000006', 'waitlisted'),
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'ffffffff-0000-0000-0000-000000000006', 'waitlisted');

-- Two seats free, a group of two that refuses to split, one table with two
-- free seats: this DOES fit, so it is promoted rather than offered.
update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = 'cccccccc-0000-0000-0000-000000000003'
 where profile_id = 'cccccccc-0000-0000-0000-000000000003';

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 1,
  'one seat free before the walk');

-- seat_assignments itself, exercised directly against the multi-table
-- split loop (not the single-table "not allow_split" search tests 1-2
-- above cover): one table, one free seat, two seats wanted, split allowed.
-- The loop fills a partial plan (this table, 1 seat) internally and must
-- still discard it and return no rows rather than hand back less than
-- was asked for.
select is_empty(
  $$select * from public.seat_assignments(
      'e1e1e1e1-0000-0000-0000-000000000001', 2,
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'wanting more than every table combined can give, split allowed, still yields no partial assignment');

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.bookings
    where group_id = '9909aaaa-0000-0000-0000-000000000004'
      and status = 'confirmed'),
  0,
  'a group that will not split is not seated one at a time');
select is(
  (select offered_seat_count from public.promotion_offers
    where group_id = '9909aaaa-0000-0000-0000-000000000004'),
  null,
  'and a group that will not split is not offered a partial fit either');
select is(
  (select waitlisted_at is not null from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000004'),
  true,
  'it keeps its place instead');

-- Now let it split.
update public.booking_groups set allow_split = true
 where id = '9909aaaa-0000-0000-0000-000000000004';

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select offered_seat_count from public.promotion_offers
    where group_id = '9909aaaa-0000-0000-0000-000000000004'
      and responded_at is null),
  1,
  'a splittable group is offered exactly the seats that exist');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'the offered seat is held against everybody else');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'promotion_offer'
      and recipient_id = 'ffffffff-0000-0000-0000-000000000006'),
  1,
  'the booker is told once');

-- Bump capacity by one so a seat is genuinely free on this second walk.
-- Without this, event_free_seats is already 0 (the offer holds the only
-- free seat), and the loop's `exit when free <= 0` would skip group_004
-- before ever reaching the "already has an outstanding offer" guard —
-- making this assertion pass even if that guard were deleted. With a real
-- free seat on the table, the guard alone is what keeps the offer count at
-- one.
update public.event_tables set capacity = 5
 where id = '7ab1e000-0000-0000-0000-000000000001';

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select count(*)::int from public.promotion_offers
    where group_id = '9909aaaa-0000-0000-0000-000000000004'),
  1,
  'running the walk again does not stack a second offer on the same group');

update public.event_tables set capacity = 4
 where id = '7ab1e000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------
-- Accepting takes the seats offered and keeps the rest of the group in
-- the queue, at its ORIGINAL place.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "ffffffff-0000-0000-0000-000000000006", "role": "authenticated"}';

select is(
  public.accept_promotion_offer(
    (select id from public.promotion_offers
      where group_id = '9909aaaa-0000-0000-0000-000000000004')),
  1,
  'accepting confirms exactly the offered number of seats');

reset role;

select is(
  (select status::text from public.bookings
    where profile_id = 'ffffffff-0000-0000-0000-000000000006'
      and group_id = '9909aaaa-0000-0000-0000-000000000004'),
  'confirmed',
  'the booker is seated first');
select is(
  (select status::text from public.bookings
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'
      and group_id = '9909aaaa-0000-0000-0000-000000000004'),
  'waitlisted',
  'the rest of the group stays waitlisted');
select is(
  (select waitlisted_at < now() - interval '20 minutes'
     from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000004'),
  true,
  'and keeps its original place in the queue');

-- ---------------------------------------------------------------------
-- Expiry: the sweep releases the hold and moves on.
--
-- Dan is now the only waitlisted booking left in group_004 (Fred already
-- took his seat above). A solo remaining member can never be OFFERED a
-- seat by promote_waitlist — with wanted = 1, any free >= 1 satisfies
-- `free >= wanted` and goes straight to confirm_group_seats, never to the
-- offer branch. So to exercise expiry at all, an offer has to be placed on
-- the group by hand here, the same way the final block below hand-inserts
-- one — standing in for "Dan was already holding an offer from an earlier
-- walk" rather than trying to provoke promote_waitlist into creating one
-- it structurally cannot.
-- ---------------------------------------------------------------------
insert into public.promotion_offers
  (group_id, event_id, offered_seat_count, expires_at) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001', 1, now() + interval '2 hours');

update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = 'aaaaaaaa-0000-0000-0000-000000000001'
 where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- No-op, but NOT because the walk reaches group_004's outstanding-offer
-- guard: event_free_seats is already 0 at this point (the offer above
-- holds the only newly-freed seat), so the loop's `exit when free <= 0`
-- stops the walk before it ever gets to group_004's row. Either way the
-- freed seat stays exactly where the offer holds it.
select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

update public.promotion_offers
   set expires_at = now() - interval '1 minute'
 where responded_at is null;

select is(public.sweep_promotion_offers(), 1,
  'the sweep expires exactly the offers past their time');
select is(
  (select outcome::text from public.promotion_offers
    where expires_at < now() and outcome is not null
    order by created_at desc limit 1),
  'expired',
  'an unanswered offer is recorded as expired, not deleted');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'promotion_offer_expired'),
  1,
  'and the booker is told it lapsed');

-- The seat the lapsed offer held went to the next member of the same
-- group, because nobody else was waiting.
select is(
  (select status::text from public.bookings
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'
      and group_id = '9909aaaa-0000-0000-0000-000000000004'),
  'confirmed',
  'a released seat is promoted in the same sweep');

-- ---------------------------------------------------------------------
-- Only the booker may answer an offer.
-- ---------------------------------------------------------------------
insert into public.promotion_offers
  (id, group_id, event_id, offered_seat_count, expires_at) values
  ('0ffe0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001', 1, now() + interval '1 hour');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_promotion_offer(
      '0ffe0000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a member of the group who did not book it cannot answer the offer');

select throws_ok(
  $$select public.decline_promotion_offer(
      '0ffe0000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'and cannot decline it either');

reset role;

-- ---------------------------------------------------------------------
-- Declining releases the hold, and the walk runs immediately — same as
-- every other seat-freeing path.
--
-- A second table gives this scenario clean, isolated capacity so it
-- doesn't have to reason about the phantom hold group_004's still-
-- outstanding offer (above) leaves on table 1.
-- ---------------------------------------------------------------------
insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'mixed', 2, 2);

insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, allow_split,
   status, waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   '7ab1e000-0000-0000-0000-000000000002', true, 'waitlisted',
   now() - interval '5 minutes');

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003', 'waitlisted');

insert into public.promotion_offers
  (id, group_id, event_id, offered_seat_count, expires_at) values
  ('0ffe0000-0000-0000-0000-000000000002',
   '9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001', 1, now() + interval '2 hours');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select public.decline_promotion_offer('0ffe0000-0000-0000-0000-000000000002');

reset role;

-- Carol is still first (and now only) in the queue, so the seat her own
-- offer was holding comes straight back to her the moment decline runs
-- promote_waitlist. This would still read 'waitlisted' if decline did not
-- call promote_waitlist itself.
select is(
  (select status::text from public.bookings
    where profile_id = 'cccccccc-0000-0000-0000-000000000003'
      and group_id = '9909aaaa-0000-0000-0000-000000000005'),
  'confirmed',
  'declining releases the seat it was holding to the next eligible booking');

-- ---------------------------------------------------------------------
-- An offer past its expires_at cannot be accepted, even by its own
-- booker.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, allow_split,
   status, waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000006',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002', true, 'waitlisted', now());

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000006',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'waitlisted');

insert into public.promotion_offers
  (id, group_id, event_id, offered_seat_count, expires_at) values
  ('0ffe0000-0000-0000-0000-000000000003',
   '9909aaaa-0000-0000-0000-000000000006',
   'e1e1e1e1-0000-0000-0000-000000000001', 1, now() - interval '5 minutes');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_promotion_offer(
      '0ffe0000-0000-0000-0000-000000000003')$$,
  '23514',
  null,
  'an offer past its expires_at cannot be accepted');

reset role;

-- ---------------------------------------------------------------------
-- A null caller (no `sub` in the JWT claims) cannot answer any offer at
-- all — the mismatch check `created_by <> auth.uid()` is NULL, not true,
-- for a null auth.uid(), so this has to be its own guard. Reuses the
-- still-outstanding, still-expired offer above: with the guard in place
-- this raises before ever inspecting expiry; without it, the call would
-- fall through to the expiry check and raise 23514 instead of 42501,
-- which is exactly the mismatch this assertion is here to catch.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$select public.accept_promotion_offer(
      '0ffe0000-0000-0000-0000-000000000003')$$,
  '42501',
  null,
  'a null caller cannot accept an offer at all');

reset role;

select * from finish();
rollback;
