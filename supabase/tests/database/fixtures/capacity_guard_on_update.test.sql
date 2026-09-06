begin;
set local search_path to extensions, public;

-- Finding #6 of the final whole-branch review: create_event/
-- create_event_series refuse a capacity under one with a friendly,
-- client-mapped message ('capacity must be at least one', 23514). Before
-- 20260906160000_capacity_guard_on_update.sql, update_event/
-- update_event_series had no such guard, so identical bad input fell
-- through to the raw `events`/`event_series` table check constraint
-- instead -- also 23514, but with a message the client's error-mapping
-- table does not recognize. These pin the new guard on both update
-- functions, on both a fresh capacity and a clear_capacity round trip, and
-- confirm a legitimate positive capacity (and an explicit clear) still
-- goes through untouched.

select plan(8);

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000061', 'host61@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('b0000000-0000-0000-0000-000000000061', 'Guard Club', 'guard-club',
          'America/New_York', 'a0000000-0000-0000-0000-000000000061');
insert into public.club_members (club_id, profile_id, role, status) values
  ('b0000000-0000-0000-0000-000000000061',
   'a0000000-0000-0000-0000-000000000061', 'host', 'active')
  on conflict do nothing;
insert into public.venues (id, added_by_club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000061',
          'b0000000-0000-0000-0000-000000000061', 'Hall 61',
          'a0000000-0000-0000-0000-000000000061');

insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           seating_mode, capacity, created_by)
values ('d0000000-0000-0000-0000-000000000061',
        'b0000000-0000-0000-0000-000000000061', 'Open night',
        'c0000000-0000-0000-0000-000000000061',
        now() + interval '1 day', now() + interval '1 day 3 hours',
        'open_seating', 60, 'a0000000-0000-0000-0000-000000000061');

insert into public.event_series (id, club_id, title, venue_id, frequency,
                                 weekday, start_time, duration_minutes,
                                 table_count, starts_on, seating_mode,
                                 capacity, created_by)
values ('50000000-0000-0000-0000-000000000061',
        'b0000000-0000-0000-0000-000000000061', 'Open series',
        'c0000000-0000-0000-0000-000000000061', 'weekly', 2, '19:00', 180,
        0, current_date, 'open_seating', 60,
        'a0000000-0000-0000-0000-000000000061');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "a0000000-0000-0000-0000-000000000061", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- update_event
-- ---------------------------------------------------------------------

select throws_ok(
  $$select public.update_event(
      target_event => 'd0000000-0000-0000-0000-000000000061'::uuid,
      new_capacity => 0)$$,
  '23514', 'capacity must be at least one',
  'update_event refuses a zero capacity with the same friendly message create_event uses');

select throws_ok(
  $$select public.update_event(
      target_event => 'd0000000-0000-0000-0000-000000000061'::uuid,
      new_capacity => -5)$$,
  '23514', 'capacity must be at least one',
  'update_event refuses a negative capacity the same way');

select is(
  (select capacity from public.events
    where id = 'd0000000-0000-0000-0000-000000000061'),
  60,
  'and the rejected calls above never touched the stored capacity');

select lives_ok(
  $$select public.update_event(
      target_event => 'd0000000-0000-0000-0000-000000000061'::uuid,
      new_capacity => 75)$$,
  'a legitimate positive capacity still goes through');

select lives_ok(
  $$select public.update_event(
      target_event => 'd0000000-0000-0000-0000-000000000061'::uuid,
      clear_capacity => true)$$,
  'an explicit clear_capacity is exempt from the guard -- uncapped is not "under one"');

-- ---------------------------------------------------------------------
-- update_event_series
-- ---------------------------------------------------------------------

select throws_ok(
  $$select public.update_event_series(
      target_series => '50000000-0000-0000-0000-000000000061'::uuid,
      new_capacity => 0)$$,
  '23514', 'capacity must be at least one',
  'update_event_series refuses a zero capacity with the same friendly message');

select throws_ok(
  $$select public.update_event_series(
      target_series => '50000000-0000-0000-0000-000000000061'::uuid,
      new_capacity => -1)$$,
  '23514', 'capacity must be at least one',
  'update_event_series refuses a negative capacity the same way');

select is(
  (select capacity from public.event_series
    where id = '50000000-0000-0000-0000-000000000061'),
  60,
  'and the rejected calls above never touched the series'' stored capacity');

select * from finish();
rollback;
