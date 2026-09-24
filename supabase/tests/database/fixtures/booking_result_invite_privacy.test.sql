begin;
set local search_path to extensions, public;
select plan(13);

/*
 * booking_result (20260924102000, fixed 20260924106000) is SECURITY
 * INVOKER but is reached only through SECURITY DEFINER RPCs
 * (commit_booking, accept_booking_invite, decline_booking, ...), so RLS
 * never runs against its own query -- the function itself must apply the
 * same privacy rule bookings_select_member and event_seating already
 * enforce (20260924104000): an invite-only game's 'invited' placement is
 * visible only to an organizer, its sender, or the invitee themselves.
 *
 * G1 (Table 1, capacity 4): Alice (organizer) invites A and B, both held.
 *   A accepts. The jsonb accept_booking_invite hands back to A must not
 *   name B's still-pending invite.
 * G2 (Table 2, capacity 4): Alice invites C, D and E, all held. D
 *   declines. The jsonb decline_booking hands back to D must not name C
 *   or E's still-pending invites.
 * Alice, calling booking_result herself, keeps seeing everyone -- the
 * organizer branch of the same filter.
 */
insert into auth.users (id, email) values
  ('b6000001-0000-0000-0000-000000000001', 'br-alice@example.com'),
  ('b6000001-0000-0000-0000-000000000002', 'br-a@example.com'),
  ('b6000001-0000-0000-0000-000000000003', 'br-b@example.com'),
  ('b6000001-0000-0000-0000-000000000004', 'br-c@example.com'),
  ('b6000001-0000-0000-0000-000000000005', 'br-d@example.com'),
  ('b6000001-0000-0000-0000-000000000006', 'br-e@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('b6000002-0000-0000-0000-000000000001', 'Booking Result Privacy Club',
   'booking-result-privacy-club', 'b6000001-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role)
select 'b6000002-0000-0000-0000-000000000001', id,
       case when id = 'b6000001-0000-0000-0000-000000000001'
            then 'host'::public.club_role else 'member'::public.club_role end
from auth.users
where email like 'br-%';

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('b6000003-0000-0000-0000-000000000001', 'Test Hall',
   'b6000002-0000-0000-0000-000000000001',
   'b6000001-0000-0000-0000-000000000001');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, status, game_mode, created_by
) values
  ('b6000004-0000-0000-0000-000000000001', 'b6000002-0000-0000-0000-000000000001',
   'Private Game', 'b6000003-0000-0000-0000-000000000001',
   now() + interval '1 day', now() + interval '1 day 3 hours', 'published',
   'invite_only', 'b6000001-0000-0000-0000-000000000001');

insert into public.event_tables (id, event_id, club_id, label, capacity, position) values
  ('b6000005-0000-0000-0000-000000000001', 'b6000004-0000-0000-0000-000000000001',
   'b6000002-0000-0000-0000-000000000001', 'Table 1', 4, 1),
  ('b6000005-0000-0000-0000-000000000002', 'b6000004-0000-0000-0000-000000000001',
   'b6000002-0000-0000-0000-000000000001', 'Table 2', 4, 2);

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "b6000001-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- G1: Alice invites A and B into one held group. Her own commit_booking
-- result names both -- an organizer always sees the full roster.
-- ---------------------------------------------------------------------
create temporary table tmp_g1 (result jsonb);
insert into tmp_g1
  select public.commit_booking(
    'b6000004-0000-0000-0000-000000000001',
    array['b6000001-0000-0000-0000-000000000002',
          'b6000001-0000-0000-0000-000000000003']::uuid[],
    'b6000005-0000-0000-0000-000000000001', true);

select ok(
  (select result from tmp_g1) -> 'placements' @> jsonb_build_array(
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000002',
      'status', 'invited')),
  'organizer''s own commit_booking result names invitee A');
select ok(
  (select result from tmp_g1) -> 'placements' @> jsonb_build_array(
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000003',
      'status', 'invited')),
  'and invitee B, both still pending');

-- ---------------------------------------------------------------------
-- A accepts. The result handed back to A must not leak B's pending
-- invite -- A is not an organizer, not B's sender, not B.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "b6000001-0000-0000-0000-000000000002", "role": "authenticated"}';

create temporary table tmp_accept (result jsonb);
insert into tmp_accept
  select public.accept_booking_invite(
    (select id from public.bookings
      where event_id = 'b6000004-0000-0000-0000-000000000001'
        and profile_id = 'b6000001-0000-0000-0000-000000000002'));

select ok(
  not ((select result from tmp_accept) -> 'placements' @> jsonb_build_array(
    jsonb_build_object('profile_id', 'b6000001-0000-0000-0000-000000000003'))),
  'the accept result does not name invitee B''s profile_id at all');
select ok(
  (select result from tmp_accept) -> 'placements' @> jsonb_build_array(
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000002',
      'status', 'confirmed')),
  'but does name A''s own now-confirmed row');

-- ---------------------------------------------------------------------
-- Alice, the organizer, still sees both afterward.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "b6000001-0000-0000-0000-000000000001", "role": "authenticated"}';

select ok(
  public.booking_result(
    (select group_id from public.bookings
      where event_id = 'b6000004-0000-0000-0000-000000000001'
        and profile_id = 'b6000001-0000-0000-0000-000000000002')
  ) -> 'placements' @> jsonb_build_array(
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000002',
      'status', 'confirmed')),
  'the organizer''s own view still names A, confirmed');
select ok(
  public.booking_result(
    (select group_id from public.bookings
      where event_id = 'b6000004-0000-0000-0000-000000000001'
        and profile_id = 'b6000001-0000-0000-0000-000000000002')
  ) -> 'placements' @> jsonb_build_array(
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000003',
      'status', 'invited')),
  'and B, still pending -- the organizer branch is unaffected');

-- ---------------------------------------------------------------------
-- G2: Alice invites C, D and E into a second held group.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "b6000001-0000-0000-0000-000000000001", "role": "authenticated"}';

create temporary table tmp_g2 (result jsonb);
insert into tmp_g2
  select public.commit_booking(
    'b6000004-0000-0000-0000-000000000001',
    array['b6000001-0000-0000-0000-000000000004',
          'b6000001-0000-0000-0000-000000000005',
          'b6000001-0000-0000-0000-000000000006']::uuid[],
    'b6000005-0000-0000-0000-000000000002', true);

select ok(
  (select result from tmp_g2) -> 'placements' @> jsonb_build_array(
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000004',
      'status', 'invited'),
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000005',
      'status', 'invited'),
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000006',
      'status', 'invited')),
  'organizer''s own commit_booking result names all three invitees');

-- ---------------------------------------------------------------------
-- D declines. The result handed back to D must not leak C or E's
-- pending invites.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "b6000001-0000-0000-0000-000000000005", "role": "authenticated"}';

create temporary table tmp_decline (result jsonb);
insert into tmp_decline
  select public.decline_booking(
    (select id from public.bookings
      where event_id = 'b6000004-0000-0000-0000-000000000001'
        and profile_id = 'b6000001-0000-0000-0000-000000000005'));

select ok(
  not ((select result from tmp_decline) -> 'placements' @> jsonb_build_array(
    jsonb_build_object('profile_id', 'b6000001-0000-0000-0000-000000000004'))),
  'the decline result does not name invitee C''s profile_id at all');
select ok(
  not ((select result from tmp_decline) -> 'placements' @> jsonb_build_array(
    jsonb_build_object('profile_id', 'b6000001-0000-0000-0000-000000000006'))),
  'nor invitee E''s');

-- ---------------------------------------------------------------------
-- C, another pending invitee (not an organizer, not the sender), gets
-- the same treatment: their own row, never E's.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "b6000001-0000-0000-0000-000000000004", "role": "authenticated"}';

select ok(
  public.booking_result(
    (select group_id from public.bookings
      where event_id = 'b6000004-0000-0000-0000-000000000001'
        and profile_id = 'b6000001-0000-0000-0000-000000000004')
  ) -> 'placements' @> jsonb_build_array(
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000004',
      'status', 'invited')),
  'a fellow pending invitee still sees their own row');
select ok(
  not (public.booking_result(
    (select group_id from public.bookings
      where event_id = 'b6000004-0000-0000-0000-000000000001'
        and profile_id = 'b6000001-0000-0000-0000-000000000004')
  ) -> 'placements' @> jsonb_build_array(
    jsonb_build_object('profile_id', 'b6000001-0000-0000-0000-000000000006'))),
  'but not E''s pending invite');

-- ---------------------------------------------------------------------
-- Alice, the organizer, still sees C and E (still pending); D's own row
-- is 'declined' now and drops out of placements entirely for everyone,
-- privacy aside (booking_result only ever returns confirmed / waitlisted
-- / invited rows).
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "b6000001-0000-0000-0000-000000000001", "role": "authenticated"}';

select ok(
  public.booking_result(
    (select group_id from public.bookings
      where event_id = 'b6000004-0000-0000-0000-000000000001'
        and profile_id = 'b6000001-0000-0000-0000-000000000004')
  ) -> 'placements' @> jsonb_build_array(
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000004',
      'status', 'invited'),
    jsonb_build_object(
      'profile_id', 'b6000001-0000-0000-0000-000000000006',
      'status', 'invited')),
  'the organizer still sees both C and E pending');
select is(
  jsonb_array_length(public.booking_result(
    (select group_id from public.bookings
      where event_id = 'b6000004-0000-0000-0000-000000000001'
        and profile_id = 'b6000001-0000-0000-0000-000000000004')
  ) -> 'placements'),
  2,
  'and D''s declined row is gone from placements for everyone');

select * from finish();
rollback;
