begin;
set local search_path to extensions, public;

select plan(18);

-- ---------------------------------------------------------------------------
-- Fixture: one club, one host, a handful of invitees. Invite rows are
-- inserted directly (no need to go through create_club_invite for these --
-- see this file's task brief), matching accept_invite_seats_guest.test.sql's
-- own now-deleted style of inserting club_invites rows by hand.
--
-- email_user's auth.users.email is DELIBERATELY all-lowercase
-- ('email@example.com') while the case-insensitivity invite below stores
-- 'Email@Example.com' -- this is the one genuinely-varying-casing case this
-- file adds (fetch_my_pending_invites' `lower(ci.email) = lower(caller_email)`
-- match), matching create_club_invite.test.sql's own dedicated case for the
-- same RPC family.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000cd01', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000cd02', 'email@example.com'),
  ('cccccccc-0000-0000-0000-00000000cd03', 'guest@example.com'),
  ('dddddddd-0000-0000-0000-00000000cd04', 'wrongperson@example.com'),
  ('eeeeeeee-0000-0000-0000-00000000cd05', 'decline@example.com'),
  ('ffffffff-0000-0000-0000-00000000cd06', 'eventguest@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000cd01', 'Invite Accept Club',
   'invite-accept-club', 'aaaaaaaa-0000-0000-0000-00000000cd01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000cd01',
   'aaaaaaaa-0000-0000-0000-00000000cd01', 'host');

-- A venue and a real, published, future event for case 9's seating path
-- (the `seat_event.id is not null and seat_event.status = 'published' and
-- seat_event.starts_at > now()` guard in accept_club_invite). One table with
-- the default capacity (4) is enough for a single guest to be seated,
-- mirroring accept_invite_seats_guest.test.sql's own table setup.
insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000cd01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000cd01',
   'aaaaaaaa-0000-0000-0000-00000000cd01');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('22222222-0000-0000-0000-00000000cd01',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'Case 9 Game',
   '11111111-0000-0000-0000-00000000cd01',
   now() + interval '1 day', now() + interval '1 day 3 hours',
   'aaaaaaaa-0000-0000-0000-00000000cd01');

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('33333333-0000-0000-0000-00000000cd01',
   '22222222-0000-0000-0000-00000000cd01',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'Table 1', 1);

-- Invite rows. Each case below gets its own row so accepting/declining one
-- never disturbs another case's fixture.
insert into public.club_invites (id, club_id, email, expires_at) values
  -- Case 1: pending, case-insensitively addressed to email_user.
  ('44440001-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'Email@Example.com',
   now() + interval '7 days'),
  -- Case 1: pending, addressed to someone else entirely.
  ('44440002-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'someoneelse@example.com',
   now() + interval '7 days'),
  -- Case 2: same email as case 1, but already accepted / declined / expired.
  ('44440003-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'email@example.com',
   now() + interval '7 days'),
  ('44440004-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'email@example.com',
   now() + interval '7 days'),
  ('44440005-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'email@example.com',
   now() - interval '1 day'),
  -- Case 3/4/5: three independent pending invites addressed to guest_user,
  -- one per accept scenario so a mutation in one never touches another.
  ('44440006-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'guest@example.com',
   now() + interval '7 days'),
  ('44440007-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'guest@example.com',
   now() + interval '7 days'),
  ('44440008-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'guest@example.com',
   now() + interval '7 days'),
  -- Case 6/7/8: two independent pending invites addressed to decline_user.
  ('44440009-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'decline@example.com',
   now() + interval '7 days'),
  ('4444000a-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'decline@example.com',
   now() + interval '7 days');

update public.club_invites
  set accepted_at = now(), accepted_by = 'bbbbbbbb-0000-0000-0000-00000000cd02'
  where id = '44440003-0000-0000-0000-000000000001';

update public.club_invites
  set declined_at = now()
  where id = '44440004-0000-0000-0000-000000000001';

-- Case 9: pending, event-tied invite addressed to event_user.
insert into public.club_invites (id, club_id, email, event_id, expires_at)
values
  ('4444000b-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-00000000cd01', 'eventguest@example.com',
   '22222222-0000-0000-0000-00000000cd01', now() + interval '7 days');

-- ---------------------------------------------------------------------------
-- Cases 1 & 2: fetch_my_pending_invites(), called as email_user.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000cd02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.fetch_my_pending_invites() t
    where t.id = '44440001-0000-0000-0000-000000000001'),
  1,
  'fetch_my_pending_invites returns an invite addressed to Email@Example.com when signed in as email@example.com'
);

select is(
  (select count(*)::int from public.fetch_my_pending_invites() t
    where t.id = '44440002-0000-0000-0000-000000000001'),
  0,
  'fetch_my_pending_invites excludes an invite addressed to a different email'
);

select is(
  (select count(*)::int from public.fetch_my_pending_invites() t
    where t.id = '44440003-0000-0000-0000-000000000001'),
  0,
  'fetch_my_pending_invites excludes an already-accepted invite'
);

select is(
  (select count(*)::int from public.fetch_my_pending_invites() t
    where t.id = '44440004-0000-0000-0000-000000000001'),
  0,
  'fetch_my_pending_invites excludes an already-declined invite'
);

select is(
  (select count(*)::int from public.fetch_my_pending_invites() t
    where t.id = '44440005-0000-0000-0000-000000000001'),
  0,
  'fetch_my_pending_invites excludes an expired invite'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 3: accept_club_invite, called by the matching email.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000cd03", "role": "authenticated"}';

select is(
  (public.accept_club_invite(
     '44440006-0000-0000-0000-000000000001')->>'club_id')::uuid,
  'c1c1c1c1-0000-0000-0000-00000000cd01'::uuid,
  'accept_club_invite called by the matching email returns the club id'
);

reset role;

select is(
  (select count(*)::int from public.club_members
    where club_id = 'c1c1c1c1-0000-0000-0000-00000000cd01'
      and profile_id = 'cccccccc-0000-0000-0000-00000000cd03'),
  1,
  'accepting by the matching email creates a club_members row'
);

-- ---------------------------------------------------------------------------
-- Case 4: accept_club_invite, called by a signed-in user whose email does
-- NOT match the invite. This is the actual bug fix -- assert both halves.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-00000000cd04", "role": "authenticated"}';

select is(
  public.accept_club_invite('44440007-0000-0000-0000-000000000001'),
  null,
  'accept_club_invite called by a non-matching email returns null'
);

reset role;

select is(
  (select count(*)::int from public.club_members
    where club_id = 'c1c1c1c1-0000-0000-0000-00000000cd01'
      and profile_id = 'dddddddd-0000-0000-0000-00000000cd04'),
  0,
  'and no club_members row is created for the non-matching caller'
);

-- ---------------------------------------------------------------------------
-- Case 5: accept_club_invite, called with no session at all.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"role": "authenticated"}';

select is(
  public.accept_club_invite('44440008-0000-0000-0000-000000000001'),
  null,
  'accept_club_invite called with no session returns null'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 6: decline_club_invite, called by the matching email.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-00000000cd05", "role": "authenticated"}';

select is(
  public.decline_club_invite('44440009-0000-0000-0000-000000000001'),
  true,
  'decline_club_invite called by the matching email returns true'
);

reset role;

-- club_invites' only SELECT policy is organizer-scoped (see
-- club_invites_select_organizer), so decline_user themselves cannot read
-- this row back directly -- checked as postgres, after reset role, the same
-- way case 8 below checks declined_at stays null.
select is(
  (select declined_at is not null from public.club_invites
    where id = '44440009-0000-0000-0000-000000000001'),
  true,
  'and the row now has declined_at set'
);

-- ---------------------------------------------------------------------------
-- Case 7: decline_club_invite, called twice in a row -- idempotent-safe.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-00000000cd05", "role": "authenticated"}';

select is(
  public.decline_club_invite('44440009-0000-0000-0000-000000000001'),
  false,
  'declining an already-declined invite a second time returns false'
);

reset role;

-- ---------------------------------------------------------------------------
-- Case 8: decline_club_invite, called by a non-matching email.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-00000000cd04", "role": "authenticated"}';

select is(
  public.decline_club_invite('4444000a-0000-0000-0000-000000000001'),
  false,
  'decline_club_invite called by a non-matching email returns false'
);

reset role;

select is(
  (select declined_at from public.club_invites
    where id = '4444000a-0000-0000-0000-000000000001'),
  null,
  'and declined_at stays null'
);

-- ---------------------------------------------------------------------------
-- Case 9: an event-tied invite accepted by the matching email seats the
-- guest at the tied event -- proving the seating logic (assert_players_
-- bookable / plan_seating / booking_groups / bookings) survived the
-- token -> id change unchanged.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "ffffffff-0000-0000-0000-00000000cd06", "role": "authenticated"}';

select is(
  (public.accept_club_invite(
     '4444000b-0000-0000-0000-000000000001')->>'event_id')::uuid,
  '22222222-0000-0000-0000-00000000cd01'::uuid,
  'accepting an event-tied invite returns the tied event id'
);

reset role;

select is(
  (select count(*)::int from public.club_members
    where club_id = 'c1c1c1c1-0000-0000-0000-00000000cd01'
      and profile_id = 'ffffffff-0000-0000-0000-00000000cd06'),
  1,
  'accepting an event-tied invite also creates club membership'
);

select is(
  (select count(*)::int from public.bookings
    where event_id = '22222222-0000-0000-0000-00000000cd01'
      and profile_id = 'ffffffff-0000-0000-0000-00000000cd06'
      and status = 'confirmed'),
  1,
  'and a confirmed bookings row exists for the guest at the tied event'
);

select * from finish();
rollback;
