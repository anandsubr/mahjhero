begin;
set local search_path to extensions, public;

select plan(18);

-- Fixture: one host, one club, one venue.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000051', 'host51@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('b0000000-0000-0000-0000-000000000051', 'Seating Club', 'seating-club-51',
          'America/New_York', 'a0000000-0000-0000-0000-000000000051');
insert into public.club_members (club_id, profile_id, role, status) values
  ('b0000000-0000-0000-0000-000000000051',
   'a0000000-0000-0000-0000-000000000051', 'host', 'active')
  on conflict do nothing;
insert into public.venues (id, added_by_club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000051',
          'b0000000-0000-0000-0000-000000000051', 'Hall 51',
          'a0000000-0000-0000-0000-000000000051');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "a0000000-0000-0000-0000-000000000051", "role": "authenticated"}';

-- ---------------------------------------------------------------------------
-- 1. Non-destructive mode switch. The Global Constraint: an assigned-tables
-- event with 2 tables and a confirmed, seated booking must keep both its
-- tables and its booking's placement across a round trip through
-- open_seating and back.
-- ---------------------------------------------------------------------------
reset role;

insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           seating_mode, created_by)
values ('d0000000-0000-0000-0000-000000000051',
        'b0000000-0000-0000-0000-000000000051', 'Assigned Night',
        'c0000000-0000-0000-0000-000000000051',
        now() + interval '1 day', now() + interval '1 day 3 hours',
        'assigned_tables', 'a0000000-0000-0000-0000-000000000051');

insert into public.event_tables (id, event_id, club_id, label, position)
values
  ('f0000000-0000-0000-0000-000000000051',
   'd0000000-0000-0000-0000-000000000051', 'b0000000-0000-0000-0000-000000000051',
   'Table 1', 1),
  ('f0000000-0000-0000-0000-000000000052',
   'd0000000-0000-0000-0000-000000000051', 'b0000000-0000-0000-0000-000000000051',
   'Table 2', 2);

insert into public.booking_groups (id, event_id, club_id, created_by,
                                   preferred_table_id, status)
values ('e1000000-0000-0000-0000-000000000051',
        'd0000000-0000-0000-0000-000000000051',
        'b0000000-0000-0000-0000-000000000051',
        'a0000000-0000-0000-0000-000000000051',
        'f0000000-0000-0000-0000-000000000051', 'confirmed');

insert into public.bookings (id, group_id, event_id, club_id, event_table_id,
                             profile_id, booked_by, status)
values ('e0000000-0000-0000-0000-000000000051',
        'e1000000-0000-0000-0000-000000000051',
        'd0000000-0000-0000-0000-000000000051',
        'b0000000-0000-0000-0000-000000000051',
        'f0000000-0000-0000-0000-000000000051',
        'a0000000-0000-0000-0000-000000000051',
        'a0000000-0000-0000-0000-000000000051', 'confirmed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "a0000000-0000-0000-0000-000000000051", "role": "authenticated"}';

select public.update_event(
  target_event => 'd0000000-0000-0000-0000-000000000051',
  new_seating_mode => 'open_seating'::public.seating_mode);

select is(
  (select count(*)::int from public.event_tables
    where event_id = 'd0000000-0000-0000-0000-000000000051'),
  2,
  'switching to open seating does not delete tables');
select is(
  (select event_table_id from public.bookings
    where id = 'e0000000-0000-0000-0000-000000000051'),
  'f0000000-0000-0000-0000-000000000051'::uuid,
  'switching to open seating does not unseat anybody');

select public.update_event(
  target_event => 'd0000000-0000-0000-0000-000000000051',
  new_seating_mode => 'assigned_tables'::public.seating_mode);

select is(
  (select count(*)::int from public.event_tables
    where event_id = 'd0000000-0000-0000-0000-000000000051'),
  2,
  'switching back to assigned tables does not delete tables');
select is(
  (select event_table_id from public.bookings
    where id = 'e0000000-0000-0000-0000-000000000051'),
  'f0000000-0000-0000-0000-000000000051'::uuid,
  'switching back to assigned tables does not unseat anybody');

-- ---------------------------------------------------------------------------
-- 2 & 3. Override is recorded, and a series edit respects it.
--
-- A series starting at assigned_tables, with two future occurrences (A, B)
-- that both inherit it. A's seating_mode is overridden by hand; B is left
-- alone. The series is then flipped twice -- open_seating, then back to
-- assigned_tables -- with include_overridden => false throughout. B must
-- follow the series both times; A, having its own override, must never move
-- off open_seating. Two flips (not one) is deliberate: after a single flip A
-- and B would coincidentally agree, since seating_mode has only two possible
-- values -- exactly the same "both start equal" trap check_in_flag.test.sql
-- pins with its own true/false/true dance. Only the second flip discriminates
-- a working override guard from a broken one.
-- ---------------------------------------------------------------------------

reset role;

insert into public.event_series (id, club_id, title, venue_id, frequency,
                                 weekday, start_time, table_count, starts_on,
                                 seating_mode, capacity, game_mode, created_by)
values ('50000000-0000-0000-0000-000000000052',
        'b0000000-0000-0000-0000-000000000051', 'Weekly 52',
        'c0000000-0000-0000-0000-000000000051', 'weekly', 2, '19:00', 1,
        current_date, 'assigned_tables', null, 'open_play',
        'a0000000-0000-0000-0000-000000000051');

insert into public.events (id, club_id, series_id, title, venue_id, starts_at,
                           ends_at, occurrence_date, seating_mode, capacity,
                           game_mode, created_by)
values
  ('60000000-0000-0000-0000-000000000052',
   'b0000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000052',
   'Weekly 52', 'c0000000-0000-0000-0000-000000000051',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   current_date + 7, 'assigned_tables', null, 'open_play',
   'a0000000-0000-0000-0000-000000000051'),
  ('60000000-0000-0000-0000-000000000053',
   'b0000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000052',
   'Weekly 52', 'c0000000-0000-0000-0000-000000000051',
   now() + interval '14 days', now() + interval '14 days 3 hours',
   current_date + 14, 'assigned_tables', null, 'open_play',
   'a0000000-0000-0000-0000-000000000051');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "a0000000-0000-0000-0000-000000000051", "role": "authenticated"}';

-- Override occurrence A by hand.
select public.update_event(
  target_event => '60000000-0000-0000-0000-000000000052',
  new_seating_mode => 'open_seating'::public.seating_mode);

select is(
  (select seating_mode::text from public.events
    where id = '60000000-0000-0000-0000-000000000052'),
  'open_seating',
  'update_event changes seating_mode when passed');
select ok(
  (select 'seating_mode' = any(overrides) from public.events
    where id = '60000000-0000-0000-0000-000000000052'),
  'update_event records the seating_mode override on a series occurrence');

-- First flip: assigned_tables -> open_seating. B (untouched) follows.
select public.update_event_series(
  target_series => '50000000-0000-0000-0000-000000000052',
  new_seating_mode => 'open_seating'::public.seating_mode,
  include_overridden => false);

select is(
  (select seating_mode::text from public.events
    where id = '60000000-0000-0000-0000-000000000053'),
  'open_seating',
  'update_event_series pushes seating_mode onto the untouched occurrence');

-- Second flip: open_seating -> assigned_tables. B follows again; A, which
-- has its own override, must stay put.
select public.update_event_series(
  target_series => '50000000-0000-0000-0000-000000000052',
  new_seating_mode => 'assigned_tables'::public.seating_mode,
  include_overridden => false);

select is(
  (select seating_mode::text from public.events
    where id = '60000000-0000-0000-0000-000000000053'),
  'assigned_tables',
  'update_event_series pushes the second flip onto the untouched occurrence too');
select is(
  (select seating_mode::text from public.events
    where id = '60000000-0000-0000-0000-000000000052'),
  'open_seating',
  'the overridden occurrence is left alone by the series edit');

-- ---------------------------------------------------------------------------
-- 4. Reset restores all three fields. This is what pins the pre-existing
-- game_mode bug closed: reset_event_to_series must restore game_mode,
-- seating_mode AND capacity, not just the two this feature adds.
-- ---------------------------------------------------------------------------

reset role;

insert into public.event_series (id, club_id, title, venue_id, frequency,
                                 weekday, start_time, table_count, starts_on,
                                 seating_mode, capacity, game_mode, created_by)
values ('50000000-0000-0000-0000-000000000060',
        'b0000000-0000-0000-0000-000000000051', 'Weekly 60',
        'c0000000-0000-0000-0000-000000000051', 'weekly', 3, '19:00', 1,
        current_date, 'assigned_tables', null, 'open_play',
        'a0000000-0000-0000-0000-000000000051');

insert into public.events (id, club_id, series_id, title, venue_id, starts_at,
                           ends_at, occurrence_date, seating_mode, capacity,
                           game_mode, created_by)
values ('60000000-0000-0000-0000-000000000060',
        'b0000000-0000-0000-0000-000000000051',
        '50000000-0000-0000-0000-000000000060',
        'Weekly 60', 'c0000000-0000-0000-0000-000000000051',
        now() + interval '21 days', now() + interval '21 days 3 hours',
        current_date + 21, 'assigned_tables', null, 'open_play',
        'a0000000-0000-0000-0000-000000000051');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "a0000000-0000-0000-0000-000000000051", "role": "authenticated"}';

select public.update_event(
  target_event => '60000000-0000-0000-0000-000000000060',
  new_seating_mode => 'open_seating'::public.seating_mode,
  new_capacity => 30,
  new_game_mode => 'invite_only'::public.game_mode);

select ok(
  (select 'game_mode' = any(overrides)
      and 'seating_mode' = any(overrides)
      and 'capacity' = any(overrides)
   from public.events where id = '60000000-0000-0000-0000-000000000060'),
  'all three fields are recorded as overrides before the reset');

select public.reset_event_to_series('60000000-0000-0000-0000-000000000060');

select is(
  (select seating_mode::text from public.events
    where id = '60000000-0000-0000-0000-000000000060'),
  'assigned_tables',
  'reset restores seating_mode from the series');
select is(
  (select capacity from public.events
    where id = '60000000-0000-0000-0000-000000000060'),
  null::int,
  'reset restores capacity from the series');
select is(
  (select game_mode::text from public.events
    where id = '60000000-0000-0000-0000-000000000060'),
  'open_play',
  'reset restores game_mode from the series -- the pre-existing bug this task closes');
select is(
  (select overrides from public.events
    where id = '60000000-0000-0000-0000-000000000060'),
  '{}'::text[],
  'reset clears the overrides array');

-- ---------------------------------------------------------------------------
-- 5. capacity override recording uses the effective value (eff_capacity),
-- not the raw new_capacity argument. new_capacity defaults to null meaning
-- "not supplied", so comparing it directly against ev.capacity cannot tell
-- "not touched" from "explicitly cleared" -- editing an unrelated field on an
-- occurrence that already has a capacity would wrongly tag 'capacity' as a
-- per-occurrence override, making it immune to future series-wide capacity
-- edits. See supabase/migrations/20260906130000_seating_mode_propagation.sql,
-- around line 334.
-- ---------------------------------------------------------------------------

reset role;

insert into public.event_series (id, club_id, title, venue_id, frequency,
                                 weekday, start_time, table_count, starts_on,
                                 seating_mode, capacity, game_mode, created_by)
values ('50000000-0000-0000-0000-000000000070',
        'b0000000-0000-0000-0000-000000000051', 'Weekly 70',
        'c0000000-0000-0000-0000-000000000051', 'weekly', 4, '19:00', 1,
        current_date, 'assigned_tables', 60, 'open_play',
        'a0000000-0000-0000-0000-000000000051');

insert into public.events (id, club_id, series_id, title, venue_id, starts_at,
                           ends_at, occurrence_date, seating_mode, capacity,
                           game_mode, created_by)
values
  ('60000000-0000-0000-0000-000000000070',
   'b0000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000070',
   'Weekly 70', 'c0000000-0000-0000-0000-000000000051',
   now() + interval '28 days', now() + interval '28 days 3 hours',
   current_date + 28, 'assigned_tables', 60, 'open_play',
   'a0000000-0000-0000-0000-000000000051'),
  ('60000000-0000-0000-0000-000000000071',
   'b0000000-0000-0000-0000-000000000051', '50000000-0000-0000-0000-000000000070',
   'Weekly 70', 'c0000000-0000-0000-0000-000000000051',
   now() + interval '35 days', now() + interval '35 days 3 hours',
   current_date + 35, 'assigned_tables', 60, 'open_play',
   'a0000000-0000-0000-0000-000000000051');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "a0000000-0000-0000-0000-000000000051", "role": "authenticated"}';

-- 5a. The bug itself: editing an unrelated field (title) on an occurrence
-- that already has a non-null capacity, with no capacity argument supplied,
-- must NOT tag 'capacity' as an override. Under the plan's original
-- "new_capacity is distinct from ev.capacity" snippet this assertion fails,
-- because the omitted new_capacity (null) reads as distinct from 60.
select public.update_event(
  target_event => '60000000-0000-0000-0000-000000000070',
  new_title => 'Weekly 70 Renamed');

select ok(
  not (select 'capacity' = any(overrides) from public.events
    where id = '60000000-0000-0000-0000-000000000070'),
  'update_event does not record a capacity override when capacity was not touched');

-- 5b. A genuine capacity change on the same occurrence is still recorded.
select public.update_event(
  target_event => '60000000-0000-0000-0000-000000000070',
  new_capacity => 90);

select ok(
  (select 'capacity' = any(overrides) from public.events
    where id = '60000000-0000-0000-0000-000000000070'),
  'update_event records the capacity override when new_capacity genuinely changes it');

-- 5c. An explicit clear (clear_capacity => true) on a fresh occurrence sets
-- capacity to null and records the override, even though the raw
-- new_capacity argument is null just like the "not touched" case in 5a.
select public.update_event(
  target_event => '60000000-0000-0000-0000-000000000071',
  clear_capacity => true);

select is(
  (select capacity from public.events
    where id = '60000000-0000-0000-0000-000000000071'),
  null::int,
  'update_event clears capacity when clear_capacity is true');
select ok(
  (select 'capacity' = any(overrides) from public.events
    where id = '60000000-0000-0000-0000-000000000071'),
  'update_event records the capacity override when clear_capacity is true');

reset role;

select * from finish();
rollback;
