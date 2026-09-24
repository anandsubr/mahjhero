begin;
set local search_path to extensions, public;

select plan(68);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),
  ('ffffffff-0000-0000-0000-000000000006', 'fred@example.com'),
  ('99999999-0000-0000-0000-000000000007', 'gina@example.com');

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

-- E1: the main game, Table 1 (4) + Table 2 (2).
-- E2: one table of 2, already full -- invites into it hold nothing.
-- E3: invite-only.
-- E4: started an hour ago, with a pending invite the sweep must close.
-- E5: a future game with a pending invite the sweep must NOT close, and
--     that cancel_event later closes.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, game_mode,
   created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'open_play', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Full game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'open_play', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Private game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'invite_only', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Right now',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'open_play', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e5e5e5e5-0000-0000-0000-000000000005',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Next month',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '30 days', now() + interval '30 days 3 hours',
   'open_play', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 2, 2),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 2, 1),
  ('7ab1e000-0000-0000-0000-000000000004',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000005',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000006',
   'e5e5e5e5-0000-0000-0000-000000000005',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1);

-- E2 is full: Fred booked himself and Gina.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'ffffffff-0000-0000-0000-000000000006',
   '7ab1e000-0000-0000-0000-000000000003');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'ffffffff-0000-0000-0000-000000000006',
   'ffffffff-0000-0000-0000-000000000006'),
  ('9909aaaa-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   '99999999-0000-0000-0000-000000000007',
   'ffffffff-0000-0000-0000-000000000006');

-- E4 (started): Bob invited Carol, seat held, never answered.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   '7ab1e000-0000-0000-0000-000000000005');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e4e4e4e4-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000005',
   'cccccccc-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true);

-- E5 (next month): Alice invited Gina, seat held.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e5e5e5e5-0000-0000-0000-000000000005',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000006');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e5e5e5e5-0000-0000-0000-000000000005',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000006',
   '99999999-0000-0000-0000-000000000007',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', true);

-- ---------------------------------------------------------------------
-- Sending: the sender is booked, everyone else is invited into a held
-- seat.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['bbbbbbbb-0000-0000-0000-000000000002',
            'cccccccc-0000-0000-0000-000000000003',
            'dddddddd-0000-0000-0000-000000000004']::uuid[],
      '7ab1e000-0000-0000-0000-000000000001', true)$$,
  'a sender books themselves and invites two members');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'confirmed',
  'the sender is booked exactly as before');
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'invited',
  'another member is invited, not booked');
select ok(
  (select invite_holds_seat
          and event_table_id = '7ab1e000-0000-0000-0000-000000000001'
     from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'and the invite holds a seat at the table the planner chose');
select is(
  (select booked_by from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'bbbbbbbb-0000-0000-0000-000000000002'::uuid,
  'booked_by names the sender');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invited'
      and event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and recipient_id in ('cccccccc-0000-0000-0000-000000000003',
                           'dddddddd-0000-0000-0000-000000000004')),
  2,
  'each invitee gets a booking_invited row');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invited'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'the sender is not invited to their own game');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booked_by_friend'),
  0,
  'booked_by_friend is no longer written on this path');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 1,
  'held seats count against the table');
select is(public.event_free_seats('e1e1e1e1-0000-0000-0000-000000000001'), 3,
  'and against the game');

-- ---------------------------------------------------------------------
-- A member already invited cannot be invited again.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'cccccccc-0000-0000-0000-000000000003']::uuid[],
      null, true)$$,
  '23514',
  'already invited',
  'a member with a pending invite cannot be invited a second time');
select throws_ok(
  $$select public.propose_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['dddddddd-0000-0000-0000-000000000004']::uuid[],
      null, true)$$,
  '23514',
  'already invited',
  'and propose_booking says so before anything is written');

-- ---------------------------------------------------------------------
-- Inviting into a full game: the invite holds nothing.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.commit_booking(
      'e2e2e2e2-0000-0000-0000-000000000002',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'dddddddd-0000-0000-0000-000000000004']::uuid[],
      '7ab1e000-0000-0000-0000-000000000003', true)$$,
  'inviting into a full game is allowed');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  'waitlisted',
  'the sender waits, as before');
select ok(
  (select status = 'invited' and invite_holds_seat = false
          and event_table_id is null
     from public.bookings
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'the invitee is invited with no seat held and no table');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invited'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and recipient_id = 'dddddddd-0000-0000-0000-000000000004'),
  1,
  'and is still told about it');

-- ---------------------------------------------------------------------
-- Invite-only: still organizer-only to send.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking(
      'e3e3e3e3-0000-0000-0000-000000000003',
      array['cccccccc-0000-0000-0000-000000000003']::uuid[], null, true)$$,
  '42501',
  null,
  'a plain member cannot invite anyone onto an invite-only game');

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e3e3e3e3-0000-0000-0000-000000000003',
      array['cccccccc-0000-0000-0000-000000000003']::uuid[],
      '7ab1e000-0000-0000-0000-000000000004', true)$$,
  'the organizer can invite onto an invite-only game');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e3e3e3e3-0000-0000-0000-000000000003'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'invited',
  'and the member is invited, not seated');

-- ---------------------------------------------------------------------
-- Accepting a held seat.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '42501',
  null,
  'a caller with no sub claim cannot accept an invite');

set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '42501',
  'not your booking',
  'another member cannot accept somebody else''s invite');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '42501',
  'not your booking',
  'not even the sender can accept on the invitee''s behalf');

set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select lives_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  'the invitee accepts');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'confirmed',
  'a held invite becomes a confirmed seat');
select ok(
  (select event_table_id = '7ab1e000-0000-0000-0000-000000000001'
          and invite_holds_seat is null
     from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'at the table that was held, with the hold flag cleared');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invite_accepted'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'the sender is told');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 1,
  'accepting a held seat takes no second seat');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '23514',
  'invite already accepted',
  'an invite cannot be accepted twice');

-- ---------------------------------------------------------------------
-- Accepting a table-less invite: a new solo group at the back of the
-- queue as of accepting. Erin's group is backdated so "behind Erin" is
-- true unconditionally, not by the luck of two uuids (now() is pinned to
-- the transaction start -- see bookings_commit.test.sql).
-- ---------------------------------------------------------------------
reset role;
update public.booking_groups
   set waitlisted_at = waitlisted_at - interval '1 minute'
 where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
   and created_by = 'eeeeeeee-0000-0000-0000-000000000005';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
          and profile_id = 'dddddddd-0000-0000-0000-000000000004'))$$,
  'the invitee accepts an invite that holds no seat');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'waitlisted',
  'and joins the waitlist');
select ok(
  (select g.created_by = 'dddddddd-0000-0000-0000-000000000004'
          and g.status = 'waitlisted'
          and g.preferred_table_id is null
     from public.bookings b
     join public.booking_groups g on g.id = b.group_id
    where b.event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and b.profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'in a group of their own, not the sender''s');
select is(
  (select public.booking_result(group_id)->>'waitlist_position'
     from public.bookings
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  '2',
  'at the back of the queue, behind the sender who was already waiting');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invite_accepted'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'and the sender is told');
select is(
  (select status::text from public.booking_groups
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'
      and created_by = 'eeeeeeee-0000-0000-0000-000000000005'),
  'waitlisted',
  'the sender''s own group keeps its place');

-- ---------------------------------------------------------------------
-- Once the game has started, nobody can answer or withdraw.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.accept_booking_invite(
      (select id from public.bookings
        where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '23514',
  'event already started',
  'an invite cannot be accepted once the game has started');
select throws_ok(
  $$select public.decline_booking(
      (select id from public.bookings
        where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '23514',
  'event already started',
  'nor declined');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  '23514',
  'event already started',
  'nor withdrawn');

-- cancel_booking is not the way out of a pending invite.
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.cancel_booking(
      (select id from public.bookings
        where event_id = 'e5e5e5e5-0000-0000-0000-000000000005'
          and profile_id = '99999999-0000-0000-0000-000000000007'))$$,
  '23514',
  'booking already closed',
  'cancel_booking refuses a pending invite; withdraw_booking_invite is the path');

-- ---------------------------------------------------------------------
-- Declining an invite frees the held seat and tells the sender.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select lives_ok(
  $$select public.decline_booking(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'dddddddd-0000-0000-0000-000000000004'))$$,
  'the invitee declines');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'declined',
  'a declined invite is declined');
select ok(
  (select invite_holds_seat is null and event_table_id is null
     from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'dddddddd-0000-0000-0000-000000000004'),
  'and gives up its hold and its table');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_declined'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'the sender is told');
select is(public.table_free_seats('7ab1e000-0000-0000-0000-000000000001'), 2,
  'and the held seat is free again');

-- ---------------------------------------------------------------------
-- Withdrawing: the sender or an organizer; nobody else.
-- Bob invites two without booking himself.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking(
      'e1e1e1e1-0000-0000-0000-000000000001',
      array['eeeeeeee-0000-0000-0000-000000000005',
            'ffffffff-0000-0000-0000-000000000006']::uuid[],
      '7ab1e000-0000-0000-0000-000000000002', true)$$,
  'a sender may invite others without booking themselves');

reset role;
select is(
  (select public.booking_result(group_id)->>'outcome'
     from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  'seated',
  'a group of held invites reports seated, as the proposal did');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "99999999-0000-0000-0000-000000000007", "role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'))$$,
  '42501',
  'not your booking',
  'another member cannot withdraw somebody else''s invite');

set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'))$$,
  '42501',
  'not your booking',
  'the invitee does not withdraw -- they decline');

set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'))$$,
  '42501',
  null,
  'a caller with no sub claim cannot withdraw an invite');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'))$$,
  'the sender withdraws an invite');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  'cancelled',
  'a withdrawn invite is cancelled');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_invite_withdrawn'
      and recipient_id = 'eeeeeeee-0000-0000-0000-000000000005'),
  1,
  'and the invitee is told');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'ffffffff-0000-0000-0000-000000000006'))$$,
  'an organizer may withdraw an invite they did not send');

reset role;
select is(
  (select status::text from public.bookings
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and profile_id = 'ffffffff-0000-0000-0000-000000000006'),
  'cancelled',
  'and it is cancelled');
select is(
  (select g.status::text from public.bookings b
     join public.booking_groups g on g.id = b.group_id
    where b.event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and b.profile_id = 'ffffffff-0000-0000-0000-000000000006'),
  'cancelled',
  'a group whose last pending invite is withdrawn is closed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.withdraw_booking_invite(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'ffffffff-0000-0000-0000-000000000006'))$$,
  '23514',
  'booking already closed',
  'a closed invite cannot be withdrawn again');

-- ---------------------------------------------------------------------
-- Leaving after accepting tells the sender; leaving your own seat tells
-- nobody.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'cccccccc-0000-0000-0000-000000000003'))$$,
  'a member leaves a seat somebody else booked for them');

reset role;
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_cancelled_by_member'
      and recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'the sender is told their invitee can''t make it anymore');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_cancelled_by_host'
      and recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  0,
  'and the member is not told they were removed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_booking(
      (select id from public.bookings
        where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
          and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'))$$,
  'the sender leaves a seat they booked themselves');

reset role;
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'booking_cancelled_by_member'),
  1,
  'which tells nobody');

-- ---------------------------------------------------------------------
-- Game start closes pending invites, silently.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.close_started_invites()$$,
  '42501',
  null,
  'a signed-in member cannot run the sweep');

reset role;
select lives_ok(
  $$select public.close_started_invites()$$,
  'the sweep runs');
select is(
  (select status::text from public.bookings
    where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'
      and profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'cancelled',
  'an invite still pending when its game started is closed');
select is(
  (select status::text from public.bookings
    where event_id = 'e5e5e5e5-0000-0000-0000-000000000005'
      and profile_id = '99999999-0000-0000-0000-000000000007'),
  'invited',
  'a future game''s invite is untouched');
select is(
  (select count(*)::int from public.notification_outbox
    where event_id = 'e4e4e4e4-0000-0000-0000-000000000004'),
  0,
  'and nobody is told');

-- ---------------------------------------------------------------------
-- Cancelling the game closes its pending invites.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.cancel_event('e5e5e5e5-0000-0000-0000-000000000005')$$,
  'the host cancels a game with a pending invite');

reset role;
select ok(
  (select status = 'cancelled' and invite_holds_seat is null
     from public.bookings
    where event_id = 'e5e5e5e5-0000-0000-0000-000000000005'
      and profile_id = '99999999-0000-0000-0000-000000000007'),
  'the pending invite is closed with the game');
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_cancelled'
      and recipient_id = '99999999-0000-0000-0000-000000000007'),
  1,
  'and the invitee is told the game is off');

select * from finish();
rollback;
