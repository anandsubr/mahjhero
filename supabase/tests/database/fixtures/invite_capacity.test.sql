begin;
set local search_path to extensions, public;

select plan(38);

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
  ('66666666-0000-0000-0000-000000000010', 'jack@example.com');

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

-- E1: assigned tables, Table 1 and Table 2 of four each (capacity 8).
-- E2: open seating, capacity 4, no tables.
-- E3: one table of four, for "need a fourth".
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, seating_mode, capacity,
   created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'assigned_tables', null, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Open night',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'open_seating', 4, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Thursday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'assigned_tables', null, 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'mixed', 4, 2),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'mixed', 4, 1);

-- Alice booked herself onto Table 1 and invited Bob, Carol and Dan, whose
-- seats there are held.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('b00c0000-0000-0000-0000-000000000002',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true),
  ('b00c0000-0000-0000-0000-000000000003',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true),
  ('b00c0000-0000-0000-0000-000000000004',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true);

-- ---------------------------------------------------------------------
-- A held tabled invite fills its table.
-- ---------------------------------------------------------------------
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 0,
  'one confirmed booking and three held invites fill a table of four');

select results_eq(
  $$select event_table_id, seats from public.seat_assignments(
      'e1e1e1e1-0000-0000-0000-000000000001', 1,
      '7ab1e000-0000-0000-0000-000000000001', false)$$,
  $$values ('7ab1e000-0000-0000-0000-000000000002'::uuid, 1)$$,
  'placement passes over a table filled by held invites, even the preferred one');

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 4,
  'held tabled invites are taken seats at event level too');

-- ---------------------------------------------------------------------
-- An unheld invite (the game was full when sent) takes nothing.
-- ---------------------------------------------------------------------
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000005',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'eeeeeeee-0000-0000-0000-000000000005',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', false);

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 4,
  'an unheld invite does not reduce the event''s free seats');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000002'), 4,
  'nor any table''s');

-- ---------------------------------------------------------------------
-- The new checks and the widened one-active-row index.
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status, invite_holds_seat)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001',
            '7ab1e000-0000-0000-0000-000000000002',
            '99999999-0000-0000-0000-000000000007',
            'aaaaaaaa-0000-0000-0000-000000000001', 'invited', false)$$,
  '23514', null,
  'an unheld invite cannot name a table');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status, invite_holds_seat)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001', null,
            '99999999-0000-0000-0000-000000000007',
            'aaaaaaaa-0000-0000-0000-000000000001', 'invited', null)$$,
  '23514', null,
  'an invited row must say whether it holds a seat');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status, invite_holds_seat)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001', null,
            '99999999-0000-0000-0000-000000000007',
            '99999999-0000-0000-0000-000000000007', 'confirmed', true)$$,
  '23514', null,
  'a non-invited row carries no invite_holds_seat');

select throws_ok(
  $$insert into public.bookings
      (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
       status)
    values ('9909aaaa-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001', null,
            'eeeeeeee-0000-0000-0000-000000000005',
            'eeeeeeee-0000-0000-0000-000000000005', 'confirmed')$$,
  '23505', null,
  'a pending invite is an active row: the invitee cannot also be booked');

-- ---------------------------------------------------------------------
-- A held "any table" invite reduces event free seats, no table's.
-- ---------------------------------------------------------------------
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000006',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'ffffffff-0000-0000-0000-000000000006',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true);

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 3,
  'a held any-table invite takes one of the event''s free seats');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000002'), 4,
  'but no particular table''s');

-- ---------------------------------------------------------------------
-- Held seats are not movable.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000002',
                                '7ab1e000-0000-0000-0000-000000000002')$$,
  '23514', 'booking not confirmed',
  'even an organizer cannot move a held invite');

reset role;

-- ---------------------------------------------------------------------
-- promote_waitlist ignores invited rows.
--
-- Ivy and Jack take two seats at Table 2, leaving the event exactly one
-- free seat. Gina waits for Table 2, keep-together, with Hank as her
-- unheld invitee in the same group. If Hank counted, the group would want
-- two, not fit, and (keep-together) be skipped.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '77777777-0000-0000-0000-000000000009',
   '7ab1e000-0000-0000-0000-000000000002');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values
  ('b00c0000-0000-0000-0000-000000000007',
   '9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   '77777777-0000-0000-0000-000000000009',
   '77777777-0000-0000-0000-000000000009'),
  ('b00c0000-0000-0000-0000-000000000008',
   '9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   '66666666-0000-0000-0000-000000000010',
   '77777777-0000-0000-0000-000000000009');

select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 1,
  'the event has exactly one free seat');

insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, allow_split,
   status, waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000007',
   '7ab1e000-0000-0000-0000-000000000002', false,
   'waitlisted', now() - interval '1 hour');

insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status,
   invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000009',
   '9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '99999999-0000-0000-0000-000000000007',
   '99999999-0000-0000-0000-000000000007', 'waitlisted', null),
  ('b00c0000-0000-0000-0000-000000000010',
   '9909aaaa-0000-0000-0000-000000000003',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '88888888-0000-0000-0000-000000000008',
   '99999999-0000-0000-0000-000000000007', 'invited', false);

select public.promote_waitlist('e1e1e1e1-0000-0000-0000-000000000001');

select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000009'),
  'confirmed',
  'the waiting member is seated: her pending invitee is not part of the group''s size');
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000010'),
  'invited',
  'the invitee is not promoted with her');
select is(
  (select invite_holds_seat from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000010'),
  false,
  'and still holds nothing');
select is(
  (select status::text from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000003'),
  'confirmed',
  'a group whose only non-invited member is seated stops waiting');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'waitlist_promoted'
      and recipient_id = '88888888-0000-0000-0000-000000000008'),
  0,
  'the invitee is never told they were promoted');
select is(
  (select count(*)::int from public.promotion_offers
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  0,
  'and no partial offer was minted around the invited row');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'the game is now full, held invites included');

-- Ivy is confirmed at Table 2; Table 1 is full of held invites.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.place_booking('b00c0000-0000-0000-0000-000000000007',
                                '7ab1e000-0000-0000-0000-000000000001')$$,
  '23514', 'table full',
  'a confirmed member cannot be moved onto seats held by invites');

-- ---------------------------------------------------------------------
-- remove_event_table unseats a held invite without failing.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.remove_event_table('7ab1e000-0000-0000-0000-000000000001')$$,
  'a table with held invites at it can be removed');

reset role;

select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000002'),
  'invited',
  'the held invite survives the table''s removal');
select is(
  (select invite_holds_seat from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000002'),
  true,
  'and still holds a seat');
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000002'),
  null,
  'now at event level, like an unseated confirmed booking');
select is(
  (select count(*)::int from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and status = 'invited' and invite_holds_seat),
  4,
  'no held invite was dropped (Bob, Carol, Dan, Fred)');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'unseated'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'the invitee is not sent an "unseated" notice (confirmed rows only, unchanged)');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'unseated'
      and recipient_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'while the confirmed member at that table still is');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 0,
  'the over-subscribed game, held invites included, floors at zero');

-- ---------------------------------------------------------------------
-- Capacity on an open-seating game counts held invites.
--
-- update_event has no "below current occupancy" guard (only "at least
-- one"), so what is asserted is that the admission arithmetic after the
-- edit counts the held invite.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', null);

insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status,
   invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000011',
   '9909aaaa-0000-0000-0000-000000000005',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('b00c0000-0000-0000-0000-000000000012',
   '9909aaaa-0000-0000-0000-000000000005',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true),
  ('b00c0000-0000-0000-0000-000000000013',
   '9909aaaa-0000-0000-0000-000000000005',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', false);

select is(
  public.plan_seating('e2e2e2e2-0000-0000-0000-000000000002',
    array['dddddddd-0000-0000-0000-000000000004',
          'eeeeeeee-0000-0000-0000-000000000005',
          'ffffffff-0000-0000-0000-000000000006']::uuid[], null, true)->>'outcome',
  'waitlisted',
  'three do not fit in capacity 4 with one confirmed and one held (the unheld invite is ignored)');
select is(
  public.plan_seating('e2e2e2e2-0000-0000-0000-000000000002',
    array['dddddddd-0000-0000-0000-000000000004',
          'eeeeeeee-0000-0000-0000-000000000005']::uuid[], null, true)->>'outcome',
  'seated',
  'two do');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event(
      target_event => 'e2e2e2e2-0000-0000-0000-000000000002'::uuid,
      new_capacity => 2)$$,
  'the host lowers capacity to confirmed + held');

reset role;

select is(public.event_free_seats('e2e2e2e2-0000-0000-0000-000000000002'), 0,
  'after the edit the held invite fills the last seat');
select is(
  public.plan_seating('e2e2e2e2-0000-0000-0000-000000000002',
    array['dddddddd-0000-0000-0000-000000000004']::uuid[], null, true)->>'outcome',
  'waitlisted',
  'so a new booking waits');

-- ---------------------------------------------------------------------
-- Need a fourth: a held seat is occupied; invitees are not fourths.
-- ---------------------------------------------------------------------
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   '7ab1e000-0000-0000-0000-000000000003');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000014',
   '9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('b00c0000-0000-0000-0000-000000000015',
   '9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('b00c0000-0000-0000-0000-000000000016',
   '9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'dddddddd-0000-0000-0000-000000000004',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true),
  ('b00c0000-0000-0000-0000-000000000017',
   '9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'ffffffff-0000-0000-0000-000000000006',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', false);

select is(public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000003'),
  'tier',
  'two confirmed and one held seat of four: the table needs a fourth');

select public.announce_table_fourth('7ab1e000-0000-0000-0000-000000000003', 'tier');

select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e3e3e3e3-0000-0000-0000-000000000003'
      and recipient_id in ('dddddddd-0000-0000-0000-000000000004',
                           'ffffffff-0000-0000-0000-000000000006')),
  0,
  'nobody with a pending invite to the game, held or not, is asked to be the fourth');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'need_a_fourth'
      and event_id = 'e3e3e3e3-0000-0000-0000-000000000003'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'while an uninvolved member is');

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('9909aaaa-0000-0000-0000-000000000006',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'eeeeeeee-0000-0000-0000-000000000005',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true);

select is(public.need_a_fourth_stage('7ab1e000-0000-0000-0000-000000000003'),
  null,
  'a held last seat is occupied: no call for a fourth over it');

select * from finish();
rollback;
