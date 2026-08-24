begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(34);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'The Annexe',
   'c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002');

-- Riverside's game: two tables of 4. Oakfield's: one table, used only to
-- prove the composite foreign keys refuse a cross-event reference.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield game',
   '11111111-0000-0000-0000-000000000002',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'advanced', 4, 2),
  ('7ab1e000-0000-0000-0000-000000000009',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c2c2c2c2-0000-0000-0000-000000000002', 'Table 1', 'mixed', 4, 1);

-- ---------------------------------------------------------------------
-- The tables exist, with the columns the rest of the plan assumes.
-- ---------------------------------------------------------------------
select has_table('public', 'booking_groups', 'booking_groups exists');
select has_table('public', 'bookings', 'bookings exists');
select has_table('public', 'promotion_offers', 'promotion_offers exists');
select has_table('public', 'notification_outbox', 'notification_outbox exists');

select col_is_null('public', 'bookings', 'event_table_id',
  'a booking may have no table — that is "any table"');
select col_is_null('public', 'booking_groups', 'preferred_table_id',
  'a group may have no preferred table');

-- ---------------------------------------------------------------------
-- Constraints. Each one is asserted by trying to violate it, because a
-- constraint that is merely present may still be spelled wrong.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001');

select lives_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'a well-formed confirmed booking inserts');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23505',
  null,
  'one active booking per person per event');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000001',
            'cccccccc-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'waitlisted')$$,
  '23514',
  null,
  'a waitlisted booking may not hold a table');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000009',
            'cccccccc-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23503',
  null,
  'a booking cannot sit at another event''s table');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c2c2c2c2-0000-0000-0000-000000000002',
            'cccccccc-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23503',
  null,
  'a booking cannot claim a club its event does not belong to');

select throws_ok(
  $$update public.bookings set status = 'cancelled'
     where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'closing a booking without recording when is refused');

select lives_ok(
  $$update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = 'aaaaaaaa-0000-0000-0000-000000000001'
     where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'closing a booking with cancelled_at recorded is allowed');

select lives_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'the same person may rebook once the first booking is closed');

-- ---------------------------------------------------------------------
-- Capacity helpers. Two tables of four; one confirmed booking.
-- ---------------------------------------------------------------------
select is(public.event_capacity('e1e1e1e1-0000-0000-0000-000000000001'), 8,
  'capacity is the sum of the tables');
select is(public.event_confirmed_seats('e1e1e1e1-0000-0000-0000-000000000001'),
  1, 'a cancelled booking does not count as confirmed');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 7,
  'free seats subtract confirmed bookings');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 3,
  'a table counts only the bookings placed at it');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000002'), 4,
  'the other table is untouched');

-- An UNSEATED confirmed booking costs the event a seat and no table a seat.
-- This is the rule the whole waitlist depends on; without it a club can
-- book past a full game indefinitely.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', null);
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values ('9909aaaa-0000-0000-0000-000000000002',
        'e1e1e1e1-0000-0000-0000-000000000001',
        'c1c1c1c1-0000-0000-0000-000000000001', null,
        'cccccccc-0000-0000-0000-000000000003',
        'cccccccc-0000-0000-0000-000000000003');

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 6,
  'an "any table" booking costs the event a seat');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 3,
  'an "any table" booking costs no table a seat');

-- A held offer is unavailable to everybody else.
insert into public.promotion_offers
  (group_id, event_id, offered_seat_count, expires_at) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001', 2, now() + interval '2 hours');

select is(public.event_held_seats('e1e1e1e1-0000-0000-0000-000000000001'), 2,
  'an outstanding offer holds its seats');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 4,
  'held seats are not free seats');

update public.promotion_offers
   set responded_at = now(), outcome = 'expired'
 where event_id = 'e1e1e1e1-0000-0000-0000-000000000001';

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 6,
  'a resolved offer releases its hold');

-- ---------------------------------------------------------------------
-- The composite FK to event_tables is scoped: deleting a table a group
-- prefers nulls only preferred_table_id, never event_id (20260825041000).
-- An unscoped `on delete set null` nulls every referencing column, and
-- event_id is NOT NULL, so this would otherwise raise 23502 the moment the
-- table is gone -- not "the group is fine, just unplaced".
-- ---------------------------------------------------------------------
insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 4', 'mixed', 4, 4);
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   '7ab1e000-0000-0000-0000-000000000004');

-- Nobody is seated at Table 4, so this delete goes straight through
-- bookings' own FK (nothing to violate) and exercises only booking_groups'.
-- Done as a raw DELETE, bypassing remove_event_table entirely, because the
-- property under test is the constraint's own behaviour, not the
-- function's belt-and-braces UPDATE in front of it.
delete from public.event_tables
  where id = '7ab1e000-0000-0000-0000-000000000004';

select is(
  (select count(*)::int from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000003'),
  1,
  'the group survives the preferred table''s deletion');
select is(
  (select preferred_table_id from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000003'),
  null,
  'its preferred_table_id is nulled');
select is(
  (select event_id from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000003'),
  'e1e1e1e1-0000-0000-0000-000000000001',
  'and its event_id is untouched, not also nulled into its own NOT NULL');

-- ---------------------------------------------------------------------
-- RLS. Carol is a Riverside member; Bob is not.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select isnt_empty(
  $$select id from public.bookings
     where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
       and status = 'confirmed'$$,
  'a club member reads the bookings for their club''s game');

select isnt_empty(
  $$select id from public.promotion_offers
     where group_id = '9909aaaa-0000-0000-0000-000000000002'$$,
  'a member of the group reads its offer');

-- notification_outbox has no grant to authenticated at all (not even an
-- RLS-filtered one), so the enforcement is a permission error, not an
-- empty result set. is_empty() has no exception handling around its
-- EXECUTE loop — a permission-denied error there is fatal to the whole
-- transaction, not a graceful pgTAP failure — so throws_ok is the correct
-- shape for "nobody reads the outbox", not is_empty.
select throws_ok(
  $$select id from public.notification_outbox$$,
  '42501',
  null,
  'nobody reads the outbox');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, profile_id, booked_by)
    values ('9909aaaa-0000-0000-0000-000000000002',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            'cccccccc-0000-0000-0000-000000000003',
            'cccccccc-0000-0000-0000-000000000003')$$,
  '42501',
  null,
  'a member cannot write a booking directly');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is_empty(
  $$select id from public.bookings
     where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  'an outsider reads none of another club''s bookings');

select is_empty(
  $$select id from public.promotion_offers$$,
  'an outsider reads none of another group''s offers');

-- Alice booked nobody into group 2 and is not in it, so the offer is not
-- hers to read even though the club is hers. This is the assertion that
-- distinguishes is_booking_group_member from is_club_member; without it,
-- rewriting the policy to is_club_member(club_id) passes every other test
-- in this file.
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is_empty(
  $$select id from public.promotion_offers
     where group_id = '9909aaaa-0000-0000-0000-000000000002'$$,
  'an offer is visible to its own group, not to the whole club');

select * from finish();
rollback;
