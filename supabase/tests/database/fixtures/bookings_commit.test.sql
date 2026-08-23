begin;
set local search_path to extensions, public;

select plan(44);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),
  ('ffffffff-0000-0000-0000-000000000006', 'fred@example.com'),
  ('99999999-0000-0000-0000-000000000007', 'gina@example.com'),
  ('88888888-0000-0000-0000-000000000008', 'hank@example.com'),
  ('77777777-0000-0000-0000-000000000009', 'ivy@example.com'),
  ('66666666-0000-0000-0000-000000000010', 'jack@example.com'),
  ('55555555-0000-0000-0000-000000000011', 'kim@example.com'),
  ('44444444-0000-0000-0000-000000000012', 'lee@example.com');

update public.profiles set skill_level = 'beginner'
 where id = 'cccccccc-0000-0000-0000-000000000003';

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

-- Everyone but Bob is in Riverside. Bob is the outsider.
insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-000000000001', id,
       case when id = 'aaaaaaaa-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users where id <> 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.club_members (club_id, profile_id, role) values
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host');

-- Bob also carries a STALE, removed Riverside row: he was a member once and
-- left. Without this, "somebody outside the club" would be proven purely by
-- the absence of any row at all, and a mutation that deletes the
-- `status = 'active'` clause from the membership check would sail through
-- undetected — exists() would already be false either way. This row gives
-- that filter something to actually catch.
insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'removed');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- E1 is the game under test: Table 1 (mixed, 4) and Table 2 (advanced, 2),
-- capacity 6. E2 is cancelled and E3 has already started; both exist only
-- to be refused.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, status, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'published', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Cancelled game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '8 days', now() + interval '8 days 3 hours',
   'cancelled', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Last week',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '1 day', now() - interval '21 hours',
   'published', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'advanced', 2, 2),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1);

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- Refusals from the validation layer, checked with propose_booking before
-- anyone in the fixture has actually been booked. propose_booking shares
-- assert_event_bookable / assert_players_bookable / plan_seating with
-- commit_booking but never writes, so these can run here for free without
-- disturbing the sequence below.
-- ---------------------------------------------------------------------
select throws_ok(
  $$select public.propose_booking(
      '00000000-0000-0000-0000-000000000000',
      array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
      null, true)$$,
  '42501',
  'no such event',
  'an event id that matches nothing is refused');

select throws_ok(
  $$select public.propose_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      '{}'::uuid[],
      null, true)$$,
  '23514',
  'no players',
  'an empty player list is refused rather than silently booking nobody');

select throws_ok(
  $$select public.propose_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
      null, true)$$,
  '23514',
  'duplicate player',
  'the same player twice in one group is refused up front, rather than left '
  'to trip the one-active-booking unique index with a bare 23505');

select throws_ok(
  $$select public.propose_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
      '7ab1e000-0000-0000-0000-000000000003', true)$$,
  '23514',
  'no such table',
  'a preferred table id that does not belong to this event is refused, not '
  'silently downgraded to position order (7ab1e000...003 is Table 1 of E3, '
  'a different event)');

-- ---------------------------------------------------------------------
-- One member, one seat, one tap.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'a member books themselves a seat');

select is(
  (select status::text from public.bookings
    where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'confirmed',
  'the booking is confirmed, not pending anything');
select is(
  (select event_table_id from public.bookings
    where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '7ab1e000-0000-0000-0000-000000000001'::uuid,
  'at the table they tapped');
select is(
  (select public.booking_result(group_id)->'placements'->0->>'table_label'
     from public.bookings
    where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Table 1',
  'and booking_result''s placements array names the table by label, not just id');

reset role;
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 5,
  'a seat is gone from the game');

-- ---------------------------------------------------------------------
-- Tiers are advisory. Carol is a beginner; Table 2 is advanced. The
-- WARNING is the client's job, and this assertion exists so nobody
-- "fixes" that by adding a check here.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['cccccccc-0000-0000-0000-000000000003']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)$$,
  'the database does not enforce skill tiers');
select is(
  (select event_table_id from public.bookings
    where profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  '7ab1e000-0000-0000-0000-000000000002'::uuid,
  'a beginner may sit at the advanced table if they choose to');

-- ---------------------------------------------------------------------
-- "Any table": confirmed, unplaced, and it still costs the game a seat.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['dddddddd-0000-0000-0000-000000000004']::uuid[],
      null, true)$$,
  'a member books without caring where they sit');
select is(
  (select event_table_id from public.bookings
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  null,
  'an "any table" booking is placed nowhere');
select is(
  (select jsonb_array_length(public.booking_result(group_id)->'placements')
     from public.bookings
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  1,
  'the "any table" booking still has exactly one placements element');
select ok(
  (select (public.booking_result(group_id)->'placements'->0 ? 'event_table_id')
      and (public.booking_result(group_id)->'placements'->0->>'event_table_id' is null)
     from public.bookings
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'and its placements element names no table id either (key present, value null)');
select ok(
  (select (public.booking_result(group_id)->'placements'->0 ? 'table_label')
      and (public.booking_result(group_id)->'placements'->0->>'table_label' is null)
     from public.bookings
    where profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'nor a table label (key present, value null)');

reset role;
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 3,
  'and still costs the game a seat');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 3,
  'while costing no table one');

-- ---------------------------------------------------------------------
-- Refusals.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['aaaaaaaa-0000-0000-0000-000000000001']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  '23514',
  'already booked',
  'a second seat for the same person in the same game is refused');

select throws_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['bbbbbbbb-0000-0000-0000-000000000002']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  '23514',
  'not a member',
  'somebody outside the club cannot be booked into its game');

select throws_ok(
  $$select public.commit_booking(
      'e2e2e2e2-0000-0000-0000-000000000002',
      array['eeeeeeee-0000-0000-0000-000000000005']::uuid[],
      null, true)$$,
  '23514',
  'event not bookable',
  'a cancelled game takes no bookings');

select throws_ok(
  $$select public.commit_booking(
      'e3e3e3e3-0000-0000-0000-000000000003',
      array['eeeeeeee-0000-0000-0000-000000000005']::uuid[],
      '7ab1e000-0000-0000-0000-000000000003', true)$$,
  '23514',
  'event already started',
  'a game that has started takes no bookings');

-- ---------------------------------------------------------------------
-- Three friends, three free seats, two tables. Propose first.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select is(
  (select public.propose_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'ffffffff-0000-0000-0000-000000000006',
            '99999999-0000-0000-0000-000000000007']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)->>'outcome'),
  'seated',
  'three into three fits');
select is(
  (select public.propose_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'ffffffff-0000-0000-0000-000000000006',
            '99999999-0000-0000-0000-000000000007']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)->>'split'),
  'true',
  'and it says plainly that they will be split up');
-- `? 'key'` (key PRESENT) is checked alongside `->>'key' is null` (key
-- present but null) because they are different jsonb facts: an omitted
-- key and a key holding JSON null both read back as SQL NULL through
-- `->>`, so a plain null check alone cannot tell "the contract promises
-- this key and it is null" from "this key was never built" -- exactly the
-- gap that let the brief's `|| jsonb_build_object(...)` tail go untested.
select ok(
  (select (x ? 'group_id') and (x->>'group_id' is null)
     from public.propose_booking(
       'e1e1e1e1-0000-0000-0000-000000000001',
       array['eeeeeeee-0000-0000-0000-000000000005',
             'ffffffff-0000-0000-0000-000000000006',
             '99999999-0000-0000-0000-000000000007']::uuid[],
       '7ab1e000-0000-0000-0000-000000000002', true) as x),
  'a proposal writes nothing, so it carries a group_id key that is null');
select ok(
  (select (x ? 'waitlist_position') and (x->>'waitlist_position' is null)
     from public.propose_booking(
       'e1e1e1e1-0000-0000-0000-000000000001',
       array['eeeeeeee-0000-0000-0000-000000000005',
             'ffffffff-0000-0000-0000-000000000006',
             '99999999-0000-0000-0000-000000000007']::uuid[],
       '7ab1e000-0000-0000-0000-000000000002', true) as x),
  'and a null waitlist_position key');
select ok(
  (select (x ? 'offer') and (x->>'offer' is null)
     from public.propose_booking(
       'e1e1e1e1-0000-0000-0000-000000000001',
       array['eeeeeeee-0000-0000-0000-000000000005',
             'ffffffff-0000-0000-0000-000000000006',
             '99999999-0000-0000-0000-000000000007']::uuid[],
       '7ab1e000-0000-0000-0000-000000000002', true) as x),
  'and a null offer key');

reset role;
select is((select count(*)::int from public.bookings), 3,
  'proposing wrote nothing');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'ffffffff-0000-0000-0000-000000000006',
            '99999999-0000-0000-0000-000000000007']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)$$,
  'committing the split books all three');

reset role;
select is(
  (select count(distinct event_table_id)::int from public.bookings
    where booked_by = 'eeeeeeee-0000-0000-0000-000000000005'),
  2,
  'across the two tables the proposal named');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booked_by_friend'),
  2,
  'the two friends are told their seats were booked for them');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booked_by_friend'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  0,
  'and the booker is not told about her own seat');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'the game is now full');

-- ---------------------------------------------------------------------
-- Full: the next member waits.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "88888888-0000-0000-0000-000000000008", "role": "authenticated"}';

-- Captured once into a temp table (commit_booking is not idempotent — a
-- second call would trip "already booked") so both its outcome and its
-- group id can be checked against the SAME invocation's return value.
create temporary table hank_commit on commit drop as
  select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['88888888-0000-0000-0000-000000000008']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true) as result;

select is(
  (select result->>'outcome' from hank_commit),
  'waitlisted',
  'a full game puts the next member on the waitlist');
select isnt(
  (select result->>'group_id' from hank_commit),
  null,
  'and commit_booking''s own return carries a non-null group id');
select is(
  (select public.booking_result(id)->>'waitlist_position'
     from public.booking_groups
    where created_by = '88888888-0000-0000-0000-000000000008'),
  '1',
  'and tells them where they stand');

-- ---------------------------------------------------------------------
-- Two seats free but no single table holds two, and this group will not
-- split. It waits — even though the game has room.
--
-- Cancelling Carol (Table 2) and Dan (the "any table" seat, which frees an
-- EVENT seat without freeing a TABLE seat) leaves Table 1 with exactly one
-- free seat and Table 2 with exactly one free seat: two seats free overall,
-- neither table able to hold the pair alone. Cancelling Carol and Gina
-- instead (as this fixture originally read) leaves Table 1 with TWO free
-- seats on its own — enough to seat the pair outright — which contradicts
-- the very point this block exists to prove and would have made the
-- assertion below fail against a correct implementation.
-- ---------------------------------------------------------------------
reset role;
update public.bookings
   set status = 'cancelled', cancelled_at = now(),
       cancelled_by = profile_id
 where profile_id in ('cccccccc-0000-0000-0000-000000000003',
                      'dddddddd-0000-0000-0000-000000000004');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "77777777-0000-0000-0000-000000000009", "role": "authenticated"}';

select is(
  (select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['77777777-0000-0000-0000-000000000009',
            '66666666-0000-0000-0000-000000000010']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', false)->>'outcome'),
  'waitlisted',
  'a group that will not split waits until one table can hold it');

reset role;
select is(
  (select status::text from public.bookings
    where profile_id = '88888888-0000-0000-0000-000000000008'),
  'confirmed',
  'and committing it promoted the member who was already waiting');

-- ---------------------------------------------------------------------
-- One seat free, a splittable pair: an offer, immediately.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "55555555-0000-0000-0000-000000000011", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['55555555-0000-0000-0000-000000000011',
            '44444444-0000-0000-0000-000000000012']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'a splittable pair with one seat free is accepted onto the waitlist');

-- Kim's group lands on the waitlist behind Ivy/Jack's -- narratively. Both
-- commits ran inside this same test transaction, where now() is pinned to
-- the transaction start, so their waitlisted_at (and created_at) values tie
-- exactly; the ordering's final tiebreaker, group id, is a fresh random
-- uuid and settles the tie arbitrarily. That is fine for promote_waitlist
-- (a real tie genuinely doesn't matter -- nobody is disadvantaged either
-- way) but makes a bad fixture: "behind one other group" has to be true
-- unconditionally, not by the luck of two random uuids. Backdating Ivy and
-- Jack's own waitlisted_at, rather than advancing Kim's, keeps this test
-- reading the same clock direction as production -- the group that has
-- been waiting LONGER is the one further ahead.
reset role;
update public.booking_groups
   set waitlisted_at = waitlisted_at - interval '1 minute'
 where created_by = '77777777-0000-0000-0000-000000000009';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "55555555-0000-0000-0000-000000000011", "role": "authenticated"}';

-- my_upcoming_bookings() -- what "Your games" reads -- must report the
-- same position booking_result already does, computed with the identical
-- (waitlisted_at, created_at, id) ordering promote_waitlist walks; a
-- screen that disagrees with the function that actually seats people is
-- worse than a screen that says nothing.
select is(
  (select waitlist_position from public.my_upcoming_bookings()
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  2,
  'my_upcoming_bookings reports the same waitlist position booking_result '
  'does -- 2nd, behind the one group ahead of it');

reset role;
select is(
  (select offered_seat_count from public.promotion_offers po
     join public.booking_groups bg on bg.id = po.group_id
    where bg.created_by = '55555555-0000-0000-0000-000000000011'),
  1,
  'and is offered the one seat that exists, without waiting for the sweep');
select is(
  (select public.booking_result(bg.id)->'offer'->>'seats'
     from public.booking_groups bg
    where bg.created_by = '55555555-0000-0000-0000-000000000011'),
  '1',
  'and booking_result itself carries that offer -- reading only from '
  'promotion_offers here would miss a rename inside the returned jsonb');

-- ---------------------------------------------------------------------
-- A cancelled group reports itself as cancelled, not lumped in with
-- "seated". Task 4 owns cancellation itself and has not landed yet, so
-- this sets booking_groups.status directly rather than calling a
-- cancellation function that does not exist.
-- ---------------------------------------------------------------------
reset role;
update public.booking_groups
   set status = 'cancelled'
 where id = (select group_id from public.bookings
              where profile_id = 'cccccccc-0000-0000-0000-000000000003');

select is(
  (select public.booking_result(id)->>'outcome'
     from public.booking_groups
    where id = (select group_id from public.bookings
                 where profile_id = 'cccccccc-0000-0000-0000-000000000003')),
  'cancelled',
  'a cancelled group is reported as cancelled, not seated');

-- ---------------------------------------------------------------------
-- Tenancy.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['bbbbbbbb-0000-0000-0000-000000000002']::uuid[],
      null, true)$$,
  '42501',
  null,
  'a member of another club cannot book into this one''s game');

select * from finish();
rollback;
