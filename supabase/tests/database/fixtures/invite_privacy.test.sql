begin;
set local search_path to extensions, public;
select plan(21);

/*
 * Who sees a pending game invite (P1, 2026-09-24).
 *
 * E1 (invite-only, Table 1):
 *   Dan   confirmed at Table 1     (booked by Alice)
 *   Erin  confirmed, no table      (booked by Alice)
 *   Fred  waitlisted               (his own group)
 *   Carol INVITED, seat held at Table 1, sent by Bob -- a plain member,
 *         so "the sender" is tested apart from "an organizer"
 * E2 (open play, Table 2):
 *   Gina  INVITED, seat held at Table 2, sent by Alice
 * Hank is a member with no booking anywhere.
 */
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000fd01', 'ip-alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000fd02', 'ip-bob@example.com'),
  ('cccccccc-0000-0000-0000-00000000fd03', 'ip-carol@example.com'),
  ('dddddddd-0000-0000-0000-00000000fd04', 'ip-dan@example.com'),
  ('eeeeeeee-0000-0000-0000-00000000fd05', 'ip-erin@example.com'),
  ('ffffffff-0000-0000-0000-00000000fd06', 'ip-fred@example.com'),
  ('99999999-0000-0000-0000-00000000fd07', 'ip-gina@example.com'),
  ('88888888-0000-0000-0000-00000000fd08', 'ip-hank@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000fd01', 'Invite Privacy Club',
   'invite-privacy-club', 'aaaaaaaa-0000-0000-0000-00000000fd01');

insert into public.club_members (club_id, profile_id, role)
select 'c1c1c1c1-0000-0000-0000-00000000fd01', id,
       case when id = 'aaaaaaaa-0000-0000-0000-00000000fd01'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users
where email like 'ip-%';

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000fd01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'aaaaaaaa-0000-0000-0000-00000000fd01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, status, game_mode, created_by
) values
  ('22222222-0000-0000-0000-00000000fd01', 'c1c1c1c1-0000-0000-0000-00000000fd01',
   'Private Game', '11111111-0000-0000-0000-00000000fd01',
   now() + interval '1 day', now() + interval '1 day 3 hours', 'published',
   'invite_only', 'aaaaaaaa-0000-0000-0000-00000000fd01'),
  ('22222222-0000-0000-0000-00000000fd02', 'c1c1c1c1-0000-0000-0000-00000000fd01',
   'Open Game', '11111111-0000-0000-0000-00000000fd01',
   now() + interval '1 day', now() + interval '1 day 3 hours', 'published',
   'open_play', 'aaaaaaaa-0000-0000-0000-00000000fd01');

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('44444444-0000-0000-0000-00000000fd01', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', 'Table 1', 1),
  ('44444444-0000-0000-0000-00000000fd02', '22222222-0000-0000-0000-00000000fd02',
   'c1c1c1c1-0000-0000-0000-00000000fd01', 'Table 2', 1);

insert into public.booking_groups
  (id, event_id, club_id, created_by, status, waitlisted_at) values
  ('55555555-0000-0000-0000-00000000fd01', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'aaaaaaaa-0000-0000-0000-00000000fd01', 'confirmed', null),
  ('55555555-0000-0000-0000-00000000fd02', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'bbbbbbbb-0000-0000-0000-00000000fd02', 'confirmed', null),
  ('55555555-0000-0000-0000-00000000fd03', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'ffffffff-0000-0000-0000-00000000fd06', 'waitlisted', now()),
  ('55555555-0000-0000-0000-00000000fd04', '22222222-0000-0000-0000-00000000fd02',
   'c1c1c1c1-0000-0000-0000-00000000fd01',
   'aaaaaaaa-0000-0000-0000-00000000fd01', 'confirmed', null);

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status, invite_holds_seat) values
  -- Dan: confirmed at Table 1.
  ('55555555-0000-0000-0000-00000000fd01', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', '44444444-0000-0000-0000-00000000fd01',
   'dddddddd-0000-0000-0000-00000000fd04', 'aaaaaaaa-0000-0000-0000-00000000fd01',
   'confirmed', null),
  -- Erin: confirmed, any table.
  ('55555555-0000-0000-0000-00000000fd01', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', null,
   'eeeeeeee-0000-0000-0000-00000000fd05', 'aaaaaaaa-0000-0000-0000-00000000fd01',
   'confirmed', null),
  -- Fred: waitlisted.
  ('55555555-0000-0000-0000-00000000fd03', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', null,
   'ffffffff-0000-0000-0000-00000000fd06', 'ffffffff-0000-0000-0000-00000000fd06',
   'waitlisted', null),
  -- Carol: invited by Bob, seat held at Table 1.
  ('55555555-0000-0000-0000-00000000fd02', '22222222-0000-0000-0000-00000000fd01',
   'c1c1c1c1-0000-0000-0000-00000000fd01', '44444444-0000-0000-0000-00000000fd01',
   'cccccccc-0000-0000-0000-00000000fd03', 'bbbbbbbb-0000-0000-0000-00000000fd02',
   'invited', true),
  -- Gina: invited by Alice to the open game, seat held at Table 2.
  ('55555555-0000-0000-0000-00000000fd04', '22222222-0000-0000-0000-00000000fd02',
   'c1c1c1c1-0000-0000-0000-00000000fd01', '44444444-0000-0000-0000-00000000fd02',
   '99999999-0000-0000-0000-00000000fd07', 'aaaaaaaa-0000-0000-0000-00000000fd01',
   'invited', true);

set local role authenticated;

-- ---------------------------------------------------------------------
-- Dan: seated on the invite-only game. Sees the roster; sees that a seat
-- is held; does not see for whom.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-00000000fd04", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'
      and status = 'invited'),
  0,
  'invite-only: a seated member cannot read another member''s pending invite');
select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'
      and status in ('confirmed', 'waitlisted')),
  3,
  'but reads every accepted booking');
select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')),
  4,
  'event_seating still returns the held seat, so it draws as taken');
select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')
    where status = 'invited' and profile_id is null
      and display_name is null and skill_level is null),
  1,
  'as an anonymous row');

-- ---------------------------------------------------------------------
-- Erin: confirmed with no table. "Accepted and holding a seat" unlocks.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-00000000fd05", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')
    where status <> 'invited'),
  3,
  'a confirmed booking with no table unlocks the invite-only roster');
select ok(
  public.event_has_my_placed_seat('22222222-0000-0000-0000-00000000fd01'),
  'event_has_my_placed_seat now means confirmed, table or not');

-- ---------------------------------------------------------------------
-- Fred: waitlisted. Does not unlock.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "ffffffff-0000-0000-0000-00000000fd06", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')),
  1,
  'a waitlisted member sees only their own row in event_seating');
select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'),
  1,
  'and reads only their own booking');

-- ---------------------------------------------------------------------
-- Carol: the invitee. Sees the game and the headcount, and her own row.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000fd03", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
    where id = '22222222-0000-0000-0000-00000000fd01'),
  1,
  'a pending invitee can see the invite-only game');
select is(
  (select array_agg(profile_id) from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')),
  array['cccccccc-0000-0000-0000-00000000fd03']::uuid[],
  'but sees only her own row, named');
select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000fd01'),
  3,
  'and the headcount, which leaves pending invites out');
select ok(
  not public.event_has_my_placed_seat('22222222-0000-0000-0000-00000000fd01'),
  'a pending invite never unlocks the roster');
select is(
  (select status::text || ':' || invite_holds_seat::text
     from public.my_upcoming_bookings()
    where event_id = '22222222-0000-0000-0000-00000000fd01'),
  'invited:true',
  'my_upcoming_bookings lists the pending invite and says a seat is held');
select ok(
  (select waitlist_position is null and offer_id is null
          and booked_by = 'bbbbbbbb-0000-0000-0000-00000000fd02'
     from public.my_upcoming_bookings()
    where event_id = '22222222-0000-0000-0000-00000000fd01'),
  'naming the sender, with no queue place or offer of the sender''s group');

-- ---------------------------------------------------------------------
-- Bob: the sender, not an organizer, not playing.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000fd02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'
      and profile_id = 'cccccccc-0000-0000-0000-00000000fd03'),
  1,
  'the sender reads the invite he sent');
select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'
      and status <> 'invited'),
  0,
  'and nothing else on a game he is not in');

-- ---------------------------------------------------------------------
-- Alice: the organizer sees everything, named.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000fd01", "role": "authenticated"}';

select is(
  (select profile_id from public.event_seating(
     '22222222-0000-0000-0000-00000000fd01')
    where status = 'invited'),
  'cccccccc-0000-0000-0000-00000000fd03'::uuid,
  'the organizer sees who is invited');
select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd01'),
  4,
  'and reads every row');

-- ---------------------------------------------------------------------
-- Hank, open play: pending invitees are shown by name to everyone.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "88888888-0000-0000-0000-00000000fd08", "role": "authenticated"}';

select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000fd02'
      and status = 'invited'),
  1,
  'open play: any member reads a pending invite');
select is(
  (select profile_id from public.event_seating(
     '22222222-0000-0000-0000-00000000fd02')
    where status = 'invited'),
  '99999999-0000-0000-0000-00000000fd07'::uuid,
  'by name');
select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000fd02'),
  0,
  'and the headcount leaves the pending invite out');

select * from finish();
rollback;
