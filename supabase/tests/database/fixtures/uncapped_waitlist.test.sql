begin;
set local search_path to extensions, public;

select plan(11);

/*
 * Task 4A: promote_waitlist and accept_promotion_offer both trust
 * event_free_seats, which is greatest(0, capacity - confirmed - held).
 * event_capacity returns 0 for an open-seating event whose capacity is
 * null (uncapped), so event_free_seats reports 0 free seats FOREVER on an
 * event that actually has unlimited room. This fixture reproduces the
 * exact path that makes that reachable: an event capped at 2, a third
 * person waitlisted, then the organizer clears the cap (Task 4's
 * update_event/update_event_series can now do this; direct SQL here is
 * equivalent and keeps this fixture about the promotion functions, not the
 * RPC surface).
 */

insert into auth.users (id, email) values
  ('44440000-0000-0000-0000-000000000001', 'alice44@example.com'),
  ('44440000-0000-0000-0000-000000000002', 'bob44@example.com'),
  ('44440000-0000-0000-0000-000000000003', 'carol44@example.com'),
  ('44440000-0000-0000-0000-000000000004', 'dave44@example.com'),
  ('44440000-0000-0000-0000-000000000005', 'erin44@example.com'),
  ('44440000-0000-0000-0000-000000000006', 'frank44@example.com'),
  ('44440000-0000-0000-0000-000000000007', 'grace44@example.com'),
  ('44440000-0000-0000-0000-000000000008', 'henry44@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('55550000-0000-0000-0000-000000000001', 'Uncapped Club', 'uncapped-club',
   'America/New_York', '44440000-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role)
select '55550000-0000-0000-0000-000000000001', id,
       case when id = '44440000-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users
where id in ('44440000-0000-0000-0000-000000000001',
             '44440000-0000-0000-0000-000000000002',
             '44440000-0000-0000-0000-000000000003',
             '44440000-0000-0000-0000-000000000004',
             '44440000-0000-0000-0000-000000000005',
             '44440000-0000-0000-0000-000000000006',
             '44440000-0000-0000-0000-000000000007',
             '44440000-0000-0000-0000-000000000008');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('66660000-0000-0000-0000-000000000001', 'The Open Hall',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------
-- Event 1: open_seating, capacity 2. Alice and Bob hold the two seats.
-- Carol waitlists. This is the scenario the bug report describes exactly.
-- ---------------------------------------------------------------------
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, seating_mode, capacity,
   created_by) values
  ('77770000-0000-0000-0000-000000000001',
   '55550000-0000-0000-0000-000000000001', 'Open night',
   '66660000-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'open_seating', 2, '44440000-0000-0000-0000-000000000001');

insert into public.booking_groups
  (id, event_id, club_id, created_by) values
  ('88880000-0000-0000-0000-000000000001',
   '77770000-0000-0000-0000-000000000001',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000001'),
  ('88880000-0000-0000-0000-000000000002',
   '77770000-0000-0000-0000-000000000001',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000002');

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by) values
  ('88880000-0000-0000-0000-000000000001',
   '77770000-0000-0000-0000-000000000001',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000001'),
  ('88880000-0000-0000-0000-000000000002',
   '77770000-0000-0000-0000-000000000001',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000002',
   '44440000-0000-0000-0000-000000000002');

insert into public.booking_groups
  (id, event_id, club_id, created_by, status, waitlisted_at) values
  ('88880000-0000-0000-0000-000000000003',
   '77770000-0000-0000-0000-000000000001',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000003', 'waitlisted',
   now() - interval '10 minutes');

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('88880000-0000-0000-0000-000000000003',
   '77770000-0000-0000-0000-000000000001',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000003',
   '44440000-0000-0000-0000-000000000003', 'waitlisted');

-- Sanity: the fixture really is full and capped before either function is
-- exercised.
select is(public.event_free_seats('77770000-0000-0000-0000-000000000001'), 0,
  'capacity 2 with two confirmed bookings leaves no free seats');

-- The organizer clears the cap: an uncapped open-seating event has
-- unlimited room, so Carol must be promotable even though
-- event_free_seats still (wrongly, if unfixed) reads 0.
update public.events set capacity = null
 where id = '77770000-0000-0000-0000-000000000001';

select public.promote_waitlist('77770000-0000-0000-0000-000000000001');

select is(
  (select status::text from public.bookings
    where profile_id = '44440000-0000-0000-0000-000000000003'
      and group_id = '88880000-0000-0000-0000-000000000003'),
  'confirmed',
  'an uncapped event promotes a waitlisted booking straight to confirmed');
select is(
  (select status::text from public.booking_groups
    where id = '88880000-0000-0000-0000-000000000003'),
  'confirmed',
  'the promoted group is confirmed too');
select is(
  (select waitlisted_at from public.booking_groups
    where id = '88880000-0000-0000-0000-000000000003'),
  null,
  'and its waitlisted_at is cleared');

-- ---------------------------------------------------------------------
-- Regression guard: restore the cap on the SAME event. With three
-- confirmed bookings now sitting against a capacity of 2, the capped path
-- must still refuse to promote anyone new -- proving event_is_capped is
-- read fresh on every call rather than remembered from the earlier,
-- uncapped one.
-- ---------------------------------------------------------------------
update public.events set capacity = 2
 where id = '77770000-0000-0000-0000-000000000001';

insert into public.booking_groups
  (id, event_id, club_id, created_by, status, waitlisted_at) values
  ('88880000-0000-0000-0000-000000000004',
   '77770000-0000-0000-0000-000000000001',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000004', 'waitlisted', now());

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('88880000-0000-0000-0000-000000000004',
   '77770000-0000-0000-0000-000000000001',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000004',
   '44440000-0000-0000-0000-000000000004', 'waitlisted');

select public.promote_waitlist('77770000-0000-0000-0000-000000000001');

select is(
  (select status::text from public.bookings
    where profile_id = '44440000-0000-0000-0000-000000000004'
      and group_id = '88880000-0000-0000-0000-000000000004'),
  'waitlisted',
  'a capped event still refuses to over-promote -- the capped path is unchanged');
select is(
  (select status::text from public.booking_groups
    where id = '88880000-0000-0000-0000-000000000004'),
  'waitlisted',
  'and the group stays waitlisted too');
select is(
  (select count(*)::int from public.promotion_offers
    where group_id = '88880000-0000-0000-0000-000000000004'),
  0,
  'not even a partial offer is minted once the cap is back');

-- ---------------------------------------------------------------------
-- Event 2: the same bug in accept_promotion_offer. A partial offer for 2
-- seats already exists (offered while the event was still capped). The
-- organizer then clears the cap. Accepting must yield the full
-- offered_seat_count, not least(offered_seat_count, event_free_seats(...))
-- clamped to zero by the same broken-for-uncapped-events reading.
-- ---------------------------------------------------------------------
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, seating_mode, capacity,
   created_by) values
  ('77770000-0000-0000-0000-000000000002',
   '55550000-0000-0000-0000-000000000001', 'Open night 2',
   '66660000-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'open_seating', 2, '44440000-0000-0000-0000-000000000001');

insert into public.booking_groups
  (id, event_id, club_id, created_by) values
  ('88880000-0000-0000-0000-000000000005',
   '77770000-0000-0000-0000-000000000002',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000005'),
  ('88880000-0000-0000-0000-000000000006',
   '77770000-0000-0000-0000-000000000002',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000006');

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by) values
  ('88880000-0000-0000-0000-000000000005',
   '77770000-0000-0000-0000-000000000002',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000005',
   '44440000-0000-0000-0000-000000000005'),
  ('88880000-0000-0000-0000-000000000006',
   '77770000-0000-0000-0000-000000000002',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000006',
   '44440000-0000-0000-0000-000000000006');

-- Grace and Henry, together, any table, split allowed -- waitlisted.
insert into public.booking_groups
  (id, event_id, club_id, created_by, allow_split, status, waitlisted_at)
  values
  ('88880000-0000-0000-0000-000000000007',
   '77770000-0000-0000-0000-000000000002',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000007', true, 'waitlisted',
   now() - interval '5 minutes');

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('88880000-0000-0000-0000-000000000007',
   '77770000-0000-0000-0000-000000000002',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000007',
   '44440000-0000-0000-0000-000000000007', 'waitlisted'),
  ('88880000-0000-0000-0000-000000000007',
   '77770000-0000-0000-0000-000000000002',
   '55550000-0000-0000-0000-000000000001',
   '44440000-0000-0000-0000-000000000008',
   '44440000-0000-0000-0000-000000000007', 'waitlisted');

-- A partial offer for both seats, hand-inserted exactly like the existing
-- suite already does for offers that must exist without depending on
-- promote_waitlist's own branch logic to have minted them.
insert into public.promotion_offers
  (id, group_id, event_id, offered_seat_count, expires_at) values
  ('99990000-0000-0000-0000-000000000001',
   '88880000-0000-0000-0000-000000000007',
   '77770000-0000-0000-0000-000000000002', 2, now() + interval '2 hours');

select is(public.event_free_seats('77770000-0000-0000-0000-000000000002'), 0,
  'event 2 is also full and capped before the cap is cleared');

update public.events set capacity = null
 where id = '77770000-0000-0000-0000-000000000002';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "44440000-0000-0000-0000-000000000007", "role": "authenticated"}';

select is(
  public.accept_promotion_offer('99990000-0000-0000-0000-000000000001'),
  2,
  'accepting on an uncapped event seats the full offered_seat_count, not a count clamped to zero');

reset role;

select is(
  (select status::text from public.bookings
    where profile_id = '44440000-0000-0000-0000-000000000007'
      and group_id = '88880000-0000-0000-0000-000000000007'),
  'confirmed',
  'the booker is seated');
select is(
  (select status::text from public.bookings
    where profile_id = '44440000-0000-0000-0000-000000000008'
      and group_id = '88880000-0000-0000-0000-000000000007'),
  'confirmed',
  'and so is the rest of the group, since both seats were granted');

select * from finish();
rollback;
