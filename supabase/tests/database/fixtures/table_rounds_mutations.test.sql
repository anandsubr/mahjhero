begin;
set local search_path to extensions, public;

select plan(16);

-- ------------------------------------------------------------------
-- Fixture.
--   host (organizer), ann + bob (seated at Table 1 of the LIVE game),
--   carol (club member, not seated anywhere), dave (not a club member).
-- ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-000000000001', 'host@example.com'),
  ('70000000-0000-0000-0000-000000000002', 'ann@example.com'),
  ('70000000-0000-0000-0000-000000000003', 'bob@example.com'),
  ('70000000-0000-0000-0000-000000000004', 'carol@example.com'),
  ('70000000-0000-0000-0000-000000000005', 'dave@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('80000000-0000-0000-0000-000000000001', 'Rounds Club',
          'rounds-club', 'America/New_York',
          '70000000-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000001', 'host', 'active'),
  ('80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000003', 'member', 'active'),
  ('80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000004', 'member', 'active')
  on conflict do nothing;

insert into public.venues (id, added_by_club_id, name, created_by)
  values ('90000000-0000-0000-0000-000000000001',
          '80000000-0000-0000-0000-000000000001', 'The Hall',
          '70000000-0000-0000-0000-000000000001');

-- Four events: live, not-yet-started, already-ended, cancelled.
insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           status, created_by) values
  ('a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', 'Live',
   '90000000-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'published', '70000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002',
   '80000000-0000-0000-0000-000000000001', 'Not Started',
   '90000000-0000-0000-0000-000000000001',
   now() + interval '1 hour', now() + interval '3 hours',
   'published', '70000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000003',
   '80000000-0000-0000-0000-000000000001', 'Ended',
   '90000000-0000-0000-0000-000000000001',
   now() - interval '3 hours', now() - interval '1 hour',
   'published', '70000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000004',
   '80000000-0000-0000-0000-000000000001', 'Cancelled',
   '90000000-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'cancelled', '70000000-0000-0000-0000-000000000001');

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001', 'Table 1', 1),
  ('b0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000002',
   '80000000-0000-0000-0000-000000000001', 'Table 1', 1),
  ('b0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000003',
   '80000000-0000-0000-0000-000000000001', 'Table 1', 1),
  ('b0000000-0000-0000-0000-000000000004',
   'a0000000-0000-0000-0000-000000000004',
   '80000000-0000-0000-0000-000000000001', 'Table 1', 1);

-- ann and bob are confirmed at the LIVE game's table.
insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000002'),
  ('c0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000003');

insert into public.bookings (group_id, event_id, club_id, event_table_id,
                             profile_id, booked_by, status) values
  ('c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000002',
   '70000000-0000-0000-0000-000000000002', 'confirmed'),
  ('c0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000001',
   '80000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000003',
   '70000000-0000-0000-0000-000000000003', 'confirmed');

-- ------------------------------------------------------------------
-- Tenancy.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  '42501',
  null,
  'a non-member is refused before anything about the table is revealed'
);

-- ------------------------------------------------------------------
-- Game-state guards. The organizer always passes the authorization rung,
-- so these isolate the state check alone.
-- ------------------------------------------------------------------
set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000002',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  '23514',
  'this game has not started yet',
  'a game that has not started refuses'
);

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000003',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  '23514',
  'this game has already ended',
  'a game that has ended refuses'
);

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000004',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  '23514',
  'event not bookable',
  'a cancelled game refuses'
);

-- ------------------------------------------------------------------
-- The authorization split: organizer or a seated occupant, nobody else.
-- ------------------------------------------------------------------
select lives_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 8)$$,
  'the organizer records a round for bob'
);

set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 5)$$,
  'ann, seated at the table, records a round for bob too'
);

set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 5)$$,
  '42501',
  'only an organizer or a player at this table can record a round',
  'carol, a club member but not seated here, is refused'
);

reset role;
select is(
  (select count(*)::int from public.table_rounds
     where event_table_id = 'b0000000-0000-0000-0000-000000000001'),
  2,
  'two rounds accumulated at the table -- a log, not a single result'
);

-- ------------------------------------------------------------------
-- Winner and points validation.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000004', 5)$$,
  '23514',
  'the winner is not seated at this table',
  'carol cannot be recorded as the winner -- she has no seat here'
);

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', 0)$$,
  '23514',
  'points must be greater than zero',
  'zero points is refused'
);

select throws_ok(
  $$select public.record_round(
      'b0000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000003', -3)$$,
  '23514',
  'points must be greater than zero',
  'negative points is refused'
);

reset role;

select is(
  (select winner_profile_id from public.table_rounds
     where event_table_id = 'b0000000-0000-0000-0000-000000000001'
     order by created_at asc limit 1)::text,
  '70000000-0000-0000-0000-000000000003',
  'the first recorded round names bob as the winner'
);

-- ------------------------------------------------------------------
-- delete_round: organizer-only, tenancy-hidden, no time restriction.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$select public.delete_round(
      (select id from public.table_rounds
         where event_table_id = 'b0000000-0000-0000-0000-000000000001'
         limit 1))$$,
  '42501',
  'no such round',
  'a non-member is refused, and the message hides whether it exists'
);

set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select public.delete_round(
      (select id from public.table_rounds
         where event_table_id = 'b0000000-0000-0000-0000-000000000001'
         limit 1))$$,
  '42501',
  'not an organizer of this club',
  'ann, who recorded a round herself, still cannot delete -- organizer only'
);

set local request.jwt.claims to
  '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.delete_round(
      (select id from public.table_rounds
         where event_table_id = 'b0000000-0000-0000-0000-000000000001'
         limit 1))$$,
  'the organizer deletes a round'
);

reset role;

select is(
  (select count(*)::int from public.table_rounds
     where event_table_id = 'b0000000-0000-0000-0000-000000000001'),
  1,
  'exactly one round remains after the delete'
);

select * from finish();
rollback;
