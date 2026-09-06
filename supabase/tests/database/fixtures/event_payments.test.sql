begin;
set local search_path to extensions, public;

select plan(14);

-- ------------------------------------------------------------------
-- Fixture.
-- ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000071', 'host71@example.com'),
  ('a0000000-0000-0000-0000-000000000072', 'member72@example.com'),
  ('a0000000-0000-0000-0000-000000000073', 'member73@example.com'),
  ('a0000000-0000-0000-0000-000000000074', 'outsider74@example.com'),
  ('a0000000-0000-0000-0000-000000000075', 'nonmember75@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('b0000000-0000-0000-0000-000000000071', 'Payments RPC Club',
          'payments-rpc-club', 'America/New_York',
          'a0000000-0000-0000-0000-000000000071');

-- Note: profile 74 (the outsider) and profile 75 (the non-member target)
-- are deliberately NOT added here.
insert into public.club_members (club_id, profile_id, role, status) values
  ('b0000000-0000-0000-0000-000000000071',
   'a0000000-0000-0000-0000-000000000071', 'host', 'active'),
  ('b0000000-0000-0000-0000-000000000071',
   'a0000000-0000-0000-0000-000000000072', 'member', 'active'),
  ('b0000000-0000-0000-0000-000000000071',
   'a0000000-0000-0000-0000-000000000073', 'member', 'active')
  on conflict do nothing;

insert into public.venues (id, added_by_club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000071',
          'b0000000-0000-0000-0000-000000000071', 'Hall',
          'a0000000-0000-0000-0000-000000000071');

-- Comfortably in the future so cancel_booking (used further down to prove
-- payment survives a cancel-and-rebook) never trips its "already started"
-- guard.
insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           created_by)
  values ('d0000000-0000-0000-0000-000000000071',
          'b0000000-0000-0000-0000-000000000071', 'Game',
          'c0000000-0000-0000-0000-000000000071',
          now() + interval '1 day', now() + interval '1 day 3 hours',
          'a0000000-0000-0000-0000-000000000071');

insert into public.booking_groups (id, event_id, club_id, created_by)
  values ('e0000000-0000-0000-0000-000000000071',
          'd0000000-0000-0000-0000-000000000071',
          'b0000000-0000-0000-0000-000000000071',
          'a0000000-0000-0000-0000-000000000073');

insert into public.bookings (id, group_id, event_id, club_id, profile_id,
                             booked_by, status) values
  ('f0000000-0000-0000-0000-000000000071',
   'e0000000-0000-0000-0000-000000000071',
   'd0000000-0000-0000-0000-000000000071',
   'b0000000-0000-0000-0000-000000000071',
   'a0000000-0000-0000-0000-000000000073',
   'a0000000-0000-0000-0000-000000000073', 'confirmed');

-- ------------------------------------------------------------------
-- Tenancy first: an outsider holding a guessed event uuid learns nothing,
-- not even that the event exists.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000074","role":"authenticated"}';

select throws_ok(
  $$select public.set_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid,
      'a0000000-0000-0000-0000-000000000073'::uuid, true)$$,
  '42501', null,
  'a non-member holding the event uuid is refused before anything else');

select throws_ok(
  $$select public.event_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid)$$,
  '42501', null,
  'event_payment_status runs the same tenancy guard');

-- ------------------------------------------------------------------
-- The host marks a member paid, and doing it twice is idempotent.
-- ------------------------------------------------------------------
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000071","role":"authenticated"}';

select lives_ok(
  $$select public.set_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid,
      'a0000000-0000-0000-0000-000000000073'::uuid, true)$$,
  'the host marks a member paid');

reset role;
select is(
  (select count(*)::int from public.event_payments
    where event_id = 'd0000000-0000-0000-0000-000000000071'),
  1,
  'the paid row actually appears');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000071","role":"authenticated"}';

select lives_ok(
  $$select public.set_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid,
      'a0000000-0000-0000-0000-000000000073'::uuid, true)$$,
  'marking paid a second time is accepted');

reset role;
select is(
  (select count(*)::int from public.event_payments
    where event_id = 'd0000000-0000-0000-0000-000000000071'),
  1,
  'marking paid twice leaves exactly one row');

-- ------------------------------------------------------------------
-- No self-service, in either direction: a plain member may neither read
-- nor write payment state, even for themselves.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000072","role":"authenticated"}';

select throws_ok(
  $$select public.set_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid,
      'a0000000-0000-0000-0000-000000000072'::uuid, true)$$,
  '42501', null,
  'a plain member cannot mark anybody paid');

select throws_ok(
  $$select public.event_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid)$$,
  '42501', null,
  'a plain member cannot read the roster''s payment state');

-- ------------------------------------------------------------------
-- Marking somebody who is not a club member at all.
-- ------------------------------------------------------------------
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000071","role":"authenticated"}';

select throws_ok(
  $$select public.set_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid,
      'a0000000-0000-0000-0000-000000000075'::uuid, true)$$,
  '23514', null,
  'marking a non-member raises the roster-membership error');

-- ------------------------------------------------------------------
-- The door read, for the host.
-- ------------------------------------------------------------------
select results_eq(
  $$select profile_id from public.event_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid)$$,
  $$values ('a0000000-0000-0000-0000-000000000073'::uuid)$$,
  'event_payment_status returns exactly the paid roster row for the host');

-- ------------------------------------------------------------------
-- Payment survives a cancel-and-rebook of the player's booking: they
-- already handed over cash, and churning their seat must not erase that.
-- ------------------------------------------------------------------
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000073","role":"authenticated"}';

select lives_ok(
  $$select public.cancel_booking(
      'f0000000-0000-0000-0000-000000000071'::uuid)$$,
  'the paid member cancels their own booking');

reset role;
-- Direct insert stands in for a fresh commit_booking flow; only the
-- resulting row shape (a new confirmed booking for the same profile at the
-- same event) matters here, not how it was produced.
insert into public.booking_groups (id, event_id, club_id, created_by)
  values ('e0000000-0000-0000-0000-000000000072',
          'd0000000-0000-0000-0000-000000000071',
          'b0000000-0000-0000-0000-000000000071',
          'a0000000-0000-0000-0000-000000000073');
insert into public.bookings (id, group_id, event_id, club_id, profile_id,
                             booked_by, status) values
  ('f0000000-0000-0000-0000-000000000072',
   'e0000000-0000-0000-0000-000000000072',
   'd0000000-0000-0000-0000-000000000071',
   'b0000000-0000-0000-0000-000000000071',
   'a0000000-0000-0000-0000-000000000073',
   'a0000000-0000-0000-0000-000000000073', 'confirmed');

select is(
  (select count(*)::int from public.event_payments
    where event_id = 'd0000000-0000-0000-0000-000000000071'
      and profile_id = 'a0000000-0000-0000-0000-000000000073'),
  1,
  'the payment row survived the cancel-and-rebook untouched');

-- ------------------------------------------------------------------
-- Unmarking deletes the row rather than storing a false.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000071","role":"authenticated"}';

select lives_ok(
  $$select public.set_payment_status(
      'd0000000-0000-0000-0000-000000000071'::uuid,
      'a0000000-0000-0000-0000-000000000073'::uuid, false)$$,
  'the host unmarks the member');

reset role;
select is(
  (select count(*)::int from public.event_payments
    where event_id = 'd0000000-0000-0000-0000-000000000071'
      and profile_id = 'a0000000-0000-0000-0000-000000000073'),
  0,
  'unmarking deleted the row rather than storing a false');

select * from finish();
rollback;
