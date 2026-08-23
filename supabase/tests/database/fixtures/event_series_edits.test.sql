begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(97);

/*
 * Series creation, series editing, resetting one week, ending a series, and
 * what a club-timezone correction does to events that already exist.
 *
 * The recurrence SHAPE is not editable: frequency, weekday, nth_week and
 * starts_on have no parameters in update_event_series. Changing the rhythm
 * means ending this series and starting another.
 *
 * ---------------------------------------------------------------------------
 * How this fixture is built, and why it is built this way.
 * ---------------------------------------------------------------------------
 *
 * The first version of this file passed 17/17 against seven of eight
 * deliberately broken versions of the functions it was supposed to be
 * testing. Every one of those escapes traced back to the same thing: the
 * fixture never put the code near a boundary. So the shape below is chosen
 * boundary-first.
 *
 *   - The series starts 28 days in the PAST and its horizon reaches forward,
 *     so there are occurrences on both sides of `now()`. The old fixture
 *     started its series 365 days out, which meant the `starts_at > now()`
 *     predicate -- the centrepiece of the propagation rule -- had literally
 *     nothing to exclude.
 *   - The customised week holds THREE overrides and the toggle-on edit
 *     touches exactly ONE of them, so "fields this edit did not touch keep
 *     their overrides" is actually observable. The old fixture's week held
 *     one override and the edit touched that one.
 *   - The timezone change happens while the series still has a live future
 *     week whose time was hand-set, a live future week that was not, a past
 *     week, and a cancelled week. The old fixture had cancelled every
 *     occurrence before it got there and reflowed only a fresh one-off.
 *   - Materialization is asserted IMMEDIATELY after create_event_series and
 *     before any sweep runs, and a second, deliberately unmaterialized series
 *     sits alongside it -- so "did creation materialize?" and "did creation
 *     materialize only its own series?" are two separate, failing-if-wrong
 *     questions.
 *
 * Series A is identified throughout by `starts_on = current_date - 28`.
 * `starts_on` is immutable (no function offers a parameter for it), so that
 * is a stable handle across every edit below. Its occurrences are identified
 * by `occurrence_date`; only series A ever materializes here, which the
 * fixture asserts rather than assumes.
 *
 * Series A's occurrence dates, referred to below as o1..o6 and p1..p2:
 *   p1 = current_date - 11   p2 = current_date - 4    (past, inserted by hand)
 *   o1 = current_date + 3    o2 = current_date + 10   o3 = current_date + 17
 *   o4 = current_date + 24   o5 = current_date + 31   o6 = current_date + 38
 */

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 'member');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'Marie''s place',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000003', 'The Annex',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

/*
 * The sibling series, inserted directly so it has never been materialized
 * and its `materialized_through` is null. A nightly sweep WOULD materialize
 * it -- it starts inside the 42-day horizon -- which is the whole point: it
 * is the tripwire for a create_event_series that reaches for the sweep
 * instead of materializing its own series.
 *
 * It doubles as the not-yet-started series that end_event_series has to cope
 * with, further down.
 */
insert into public.event_series (
  id, club_id, title, venue_id, notes, frequency, weekday, nth_week,
  start_time, duration_minutes, table_count, starts_on, ends_on, created_by
) values (
  '55555555-0000-0000-0000-000000000003',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Sunday social',
  '11111111-0000-0000-0000-000000000001', '',
  'weekly', extract(dow from current_date + 5)::smallint, null,
  '14:00'::time, 120, 1, current_date + 5, current_date + 90,
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- A one-off event, with no series at all. It is what the wall-clock rule
-- exists for (nothing to recompute it from) and it is also the thing
-- reset_event_to_series must refuse.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e9e9e9e9-0000-0000-0000-000000000009',
   'c1c1c1c1-0000-0000-0000-000000000001', 'One-off game',
   '11111111-0000-0000-0000-000000000001',
   ((current_date + 45) + time '18:30') at time zone 'America/New_York',
   ((current_date + 45) + time '21:30') at time zone 'America/New_York',
   'aaaaaaaa-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------------
-- 1. Creation materializes, synchronously, and only this series.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.create_event_series(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Weekly game',
      '11111111-0000-0000-0000-000000000001', 'Bring your own tiles',
      'weekly', extract(dow from current_date + 3)::smallint, null,
      '19:00'::time, 180, 2,
      current_date - 28, current_date + 120)$$,
  'an organizer can create a series'
);

-- Asserted HERE, before anything sweeps, because a later sweep would satisfy
-- these numbers just as well and the question is whether the host's own
-- request materialized. The window is [current_date, current_date + 42] and
-- the rule lands on +3, +10, +17, +24, +31, +38: six, exactly.
select is(
  (select count(*)::int from public.events
   where occurrence_date is not null),
  6,
  'creating a series materializes its horizon in the same transaction'
);

select is(
  (select count(*)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.occurrence_date is not null),
  12,
  'and gives each of those six occurrences its two tables'
);

select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000003'),
  0,
  'creation materializes its own series only, never every series in the system'
);

-- ---------------------------------------------------------------------------
-- 2. Two occurrences in the past, and three customised or cancelled weeks.
-- ---------------------------------------------------------------------------

set local role postgres;

-- Materialization floors its window at current_date on purpose (it does not
-- invent games that never happened), so history has to be planted by hand.
-- Both dates are genuine dates of this series' own rule.
insert into public.events
  (club_id, series_id, title, venue_id, notes,
   starts_at, ends_at, occurrence_date, created_by)
select
  'c1c1c1c1-0000-0000-0000-000000000001',
  (select id from public.event_series where starts_on = current_date - 28),
  'Weekly game', '11111111-0000-0000-0000-000000000001',
  'Bring your own tiles',
  (d + time '19:00') at time zone 'America/New_York',
  (d + time '22:00') at time zone 'America/New_York',
  d, 'aaaaaaaa-0000-0000-0000-000000000001'
from (values (current_date - 11), (current_date - 4)) v(d);

select is(
  (select count(*)::int from public.events
   where occurrence_date is not null and starts_at < now()),
  2,
  'the series now has occurrences on both sides of now'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- o1 is customised three ways at once, so a later edit can touch exactly one
-- of its overrides and leave the other two to be observed.
select lives_ok(
  $$select public.update_event(
      (select id from public.events where occurrence_date = current_date + 3),
      null,
      '11111111-0000-0000-0000-000000000002',
      'Cake this week',
      null, '18:00', 180)$$,
  'one week is customised: venue, notes and time'
);

select results_eq(
  $$select overrides from public.events
    where occurrence_date = current_date + 3$$,
  $$values (array['notes', 'starts_at', 'venue_id']::text[])$$,
  'and records exactly those three overrides'
);

-- o4 is customised on the venue only.
select lives_ok(
  $$select public.update_event(
      (select id from public.events where occurrence_date = current_date + 24),
      null, '11111111-0000-0000-0000-000000000002', null, null, null, null)$$,
  'another week is moved to a different venue, and nothing else'
);

-- o2 is cancelled.
select lives_ok(
  $$select public.cancel_event(
      (select id from public.events where occurrence_date = current_date + 10))$$,
  'a third week is cancelled'
);

-- ---------------------------------------------------------------------------
-- 3. The default: a title and time edit skips the fields that were
--    overridden, skips cancelled weeks, and never rewrites history.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series where starts_on = current_date - 28),
      'Renamed game', null, null, '18:30'::time, null, null, null, false)$$,
  'the series title and start time are changed, toggle off'
);

select is(
  (select title from public.events where occurrence_date = current_date + 17),
  'Renamed game',
  'an un-customised week takes the new title'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date + 17),
  '18:30',
  'and the new start time'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date + 3),
  '18:00',
  'the hand-set week keeps the time its host set'
);

select is(
  (select title from public.events where occurrence_date = current_date + 3),
  'Renamed game',
  'but still takes the title it never overrode'
);

select is(
  (select venue_id from public.events where occurrence_date = current_date + 3),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'and keeps the venue this edit did not touch'
);

select is(
  (select title from public.events where occurrence_date = current_date + 10),
  'Weekly game',
  'a cancelled week is not retitled'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date + 10),
  '19:00',
  'nor re-timed'
);

select is(
  (select title from public.events where occurrence_date = current_date - 4),
  'Weekly game',
  'a past occurrence is history and keeps its title'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date - 4),
  '19:00',
  'and keeps its time'
);

select is(
  (select count(*)::int from public.events
   where occurrence_date is not null
     and starts_at > now()
     and status <> 'cancelled'
     and to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
         <> '18:30'),
  1,
  'exactly one live future week -- the hand-set one -- is off the new time'
);

-- ---------------------------------------------------------------------------
-- 4. The default, again, on the venue. This is the edit the old fixture never
--    made: a venue change with the toggle OFF, while weeks hold venue
--    overrides.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series where starts_on = current_date - 28),
      null, '11111111-0000-0000-0000-000000000003', null, null, null, null,
      null, false)$$,
  'the series moves to a new venue, toggle off'
);

select is(
  (select venue_id from public.events where occurrence_date = current_date + 17),
  '11111111-0000-0000-0000-000000000003'::uuid,
  'an un-customised week follows the series to the new venue'
);

select is(
  (select venue_id from public.events where occurrence_date = current_date + 24),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'a week whose venue was overridden is left where its host put it'
);

select is(
  (select venue_id from public.events where occurrence_date = current_date + 3),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'and so is the week that overrode venue among other things'
);

select is(
  (select venue_id from public.events where occurrence_date = current_date + 10),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'a cancelled week does not follow the series to the new venue'
);

select is(
  (select venue_id from public.events where occurrence_date = current_date - 4),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'nor does a past one'
);

select results_eq(
  $$select overrides from public.events
    where occurrence_date = current_date + 24$$,
  $$values (array['venue_id']::text[])$$,
  'and with the toggle off nothing is cleared from any overrides'
);

-- ---------------------------------------------------------------------------
-- 5. The opt-in. One field of three is edited on a week that overrode all
--    three. The other two must survive -- value AND override.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series where starts_on = current_date - 28),
      null, null, null, '17:45'::time, null, null, null, true)$$,
  'the start time moves again, this time with the override toggle on'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date + 3),
  '17:45',
  'the hand-set week is pulled onto the series'' new time'
);

select results_eq(
  $$select overrides from public.events
    where occurrence_date = current_date + 3$$,
  $$values (array['notes', 'venue_id']::text[])$$,
  'and loses only the starts_at override, keeping the two it did not touch'
);

select is(
  (select venue_id from public.events where occurrence_date = current_date + 3),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'its hand-set venue survives the toggle'
);

select is(
  (select notes from public.events where occurrence_date = current_date + 3),
  'Cake this week',
  'and so do its hand-written notes'
);

select is(
  (select status::text from public.events
   where occurrence_date = current_date + 10),
  'cancelled',
  'the toggle does not un-cancel a week'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date + 10),
  '19:00',
  'nor re-time one'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date - 4),
  '19:00',
  'and it does not reach into the past either'
);

-- ---------------------------------------------------------------------------
-- 6. The gate itself. The edit screen sends every field on every save, so a
--    save that changes nothing must change nothing -- toggle or no toggle.
--    This is the assertion that stops the toggle from becoming a global
--    reset.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series where starts_on = current_date - 28),
      'Renamed game',
      '11111111-0000-0000-0000-000000000003',
      'Bring your own tiles',
      '17:45'::time, 180, 2, (current_date + 120), true)$$,
  'a save that resends every field unchanged, toggle on, is accepted'
);

select results_eq(
  $$select overrides from public.events
    where occurrence_date = current_date + 3$$,
  $$values (array['notes', 'venue_id']::text[])$$,
  'and clears nothing: the toggle applies an edit, it is not a reset button'
);

select is(
  (select venue_id from public.events where occurrence_date = current_date + 3),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'the customised week keeps its venue through it'
);

select is(
  (select notes from public.events where occurrence_date = current_date + 3),
  'Cake this week',
  'and its notes'
);

-- ---------------------------------------------------------------------------
-- 7. reset_event_to_series: the control that undoing one week actually needs.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.reset_event_to_series(
      (select id from public.events where occurrence_date = current_date + 3))$$,
  'an organizer resets one week to its series'
);

select is(
  (select title from public.events where occurrence_date = current_date + 3),
  'Renamed game',
  'the reset week takes the series title'
);

select is(
  (select venue_id from public.events where occurrence_date = current_date + 3),
  '11111111-0000-0000-0000-000000000003'::uuid,
  'the series venue'
);

select is(
  (select notes from public.events where occurrence_date = current_date + 3),
  'Bring your own tiles',
  'the series notes'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date + 3),
  '17:45',
  'its start recomputed from its own date and the series'' local time'
);

select is(
  (select to_char(ends_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date + 3),
  '20:45',
  'and its end from the series'' duration'
);

select results_eq(
  $$select overrides from public.events
    where occurrence_date = current_date + 3$$,
  $$values (array[]::text[])$$,
  'with every override cleared'
);

select throws_ok(
  $$select public.reset_event_to_series(
      'e9e9e9e9-0000-0000-0000-000000000009')$$,
  '42501',
  'this event is not part of a series',
  'a one-off event has no series to reset to'
);

select throws_ok(
  $$select public.reset_event_to_series(
      (select id from public.events where occurrence_date = current_date + 10))$$,
  '42501',
  'a cancelled event cannot be edited',
  'and a cancelled week is not quietly brought back by a reset'
);

-- Fix pass 2: reset_event_to_series must refuse a past occurrence too. p1
-- (current_date - 11) is genuinely in the past, genuinely part of series A,
-- not cancelled, and untouched by anything so far -- so this is a clean
-- refusal, not a side effect of one of the other two guards.
select throws_ok(
  $$select public.reset_event_to_series(
      (select id from public.events where occurrence_date = current_date - 11))$$,
  '42501',
  'a past occurrence is history and cannot be reset',
  'nor is a past occurrence, even an un-cancelled, un-overridden one'
);

-- ---------------------------------------------------------------------------
-- 8. table_count applies to occurrences materialized later, never to ones
--    that already exist.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series where starts_on = current_date - 28),
      null, null, null, null, null, 4, null, false)$$,
  'the series table count is raised from two to four'
);

select is(
  (select count(*)::int from public.event_tables
   where event_id = (select id from public.events
                     where occurrence_date = current_date + 17)),
  2,
  'an occurrence that already exists keeps the tables it was materialized with'
);

set local role postgres;
select public.materialize_one_series(
  (select id from public.event_series where starts_on = current_date - 28), 70);

select is(
  (select count(*)::int from public.event_tables
   where event_id = (select id from public.events
                     where occurrence_date = current_date + 45)),
  4,
  'an occurrence materialized afterwards gets the new count'
);

-- ---------------------------------------------------------------------------
-- 9. Every one of these is organizer-only.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.create_event_series(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Bob''s game',
      '11111111-0000-0000-0000-000000000001')$$,
  '42501',
  'not an organizer of this club',
  'a plain member cannot create a series'
);

select throws_ok(
  $$select public.update_event_series(
      (select id from public.event_series where starts_on = current_date - 28),
      'Bob was here')$$,
  '42501',
  'not an organizer of this club',
  'nor edit one'
);

select throws_ok(
  $$select public.end_event_series(
      (select id from public.event_series where starts_on = current_date - 28))$$,
  '42501',
  'not an organizer of this club',
  'nor end one'
);

select throws_ok(
  $$select public.reset_event_to_series(
      (select id from public.events where occurrence_date = current_date + 17))$$,
  '42501',
  'not an organizer of this club',
  'nor reset a week to its series'
);

-- ---------------------------------------------------------------------------
-- 10. The club-timezone reflow. A correction of interpretation reaches every
--     live future event, hand-set ones and one-offs included, and stops at
--     cancelled events and at history.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- Hand-set one live future week's time, immediately before the change, so
-- the reflow meets an occurrence carrying a `starts_at` override.
select lives_ok(
  $$select public.update_event(
      (select id from public.events where occurrence_date = current_date + 31),
      null, null, null, null, '16:15', 180)$$,
  'one live future week has its time hand-set, just before the correction'
);

set local role postgres;

update public.clubs set timezone = 'America/Chicago'
  where id = 'c1c1c1c1-0000-0000-0000-000000000001';

select is(
  (select to_char(starts_at at time zone 'America/Chicago', 'HH24:MI')
   from public.events where occurrence_date = current_date + 31),
  '16:15',
  'a correction reflows a week whose time was set by hand'
);

select is(
  (select to_char(ends_at at time zone 'America/Chicago', 'HH24:MI')
   from public.events where occurrence_date = current_date + 31),
  '19:15',
  'both of its instants'
);

select is(
  (select to_char(starts_at at time zone 'America/Chicago', 'HH24:MI')
   from public.events where occurrence_date = current_date + 17),
  '17:45',
  'and a week whose time was not'
);

select is(
  (select to_char(starts_at at time zone 'America/Chicago', 'HH24:MI')
   from public.events where id = 'e9e9e9e9-0000-0000-0000-000000000009'),
  '18:30',
  'one-off events, which have no series rule to recompute from, included'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date + 10),
  '19:00',
  'a cancelled event is left at the instant it always had'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where occurrence_date = current_date - 4),
  '19:00',
  'and so is a past one'
);

-- ---------------------------------------------------------------------------
-- 11. Ending a series. `ends_on` is what the host planned; `ended_at` is the
--     host stopping it. Materialization looks at the second.
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- The sibling series has not started yet. Writing `ends_on = current_date`
-- here would be earlier than its own `starts_on` and die on
-- event_series_ends_after_start.
select lives_ok(
  $$select public.end_event_series(
      '55555555-0000-0000-0000-000000000003', true)$$,
  'a host can end a series whose first game has not happened yet'
);

select is(
  (select ends_on from public.event_series
   where id = '55555555-0000-0000-0000-000000000003'),
  current_date + 90,
  'ending a series does not move the last date its host planned'
);

select ok(
  (select ended_at is not null from public.event_series
   where id = '55555555-0000-0000-0000-000000000003'),
  'it records the moment the host stopped it instead'
);

set local role postgres;
select public.materialize_event_series(90);

select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000003'),
  0,
  'and the nightly sweep no longer generates anything for it'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event_series(
      '55555555-0000-0000-0000-000000000003', 'Renamed social')$$,
  'an ended series can still be renamed'
);

select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000003'),
  0,
  'and editing it does not materialize a fresh occurrence'
);

select ok(
  (select ended_at is not null from public.event_series
   where id = '55555555-0000-0000-0000-000000000003'),
  'nor does editing it un-end it'
);

-- ---------------------------------------------------------------------------
-- 12. Ending the live series still cancels its future, and still leaves
--     history alone.
-- ---------------------------------------------------------------------------

select lives_ok(
  $$select public.end_event_series(
      (select id from public.event_series where starts_on = current_date - 28),
      true)$$,
  'an organizer ends the live series and cancels its future occurrences'
);

select is(
  (select count(*)::int from public.events
   where occurrence_date is not null
     and starts_at > now() and status <> 'cancelled'),
  0,
  'no live future occurrence survives it'
);

select is(
  (select count(*)::int from public.events
   where occurrence_date is not null
     and starts_at < now() and status = 'cancelled'),
  0,
  'and no past occurrence is cancelled by it'
);

select is(
  (select ends_on from public.event_series where starts_on = current_date - 28),
  current_date + 120,
  'its planned ends_on is untouched here too'
);

select ok(
  (select ended_at is not null from public.event_series
   where starts_on = current_date - 28),
  'and its ended_at is set'
);

-- ---------------------------------------------------------------------------
-- 13. Fix pass 2: new_duration and new_ends_on had no mutation-tested
--     coverage, and the shortening branch's own `starts_at > now()` guard had
--     none either. A dedicated series, C, isolates all of it from series A
--     and the sibling above -- both already ended by this point -- so
--     shortening series C's run here cannot disturb an assertion already
--     proven earlier in this file. By this point the club's timezone is
--     'America/Chicago' (section 10), so every clock check below reads in
--     that zone, matching whatever club_tz update_event_series itself reads.
-- ---------------------------------------------------------------------------

set local role postgres;

insert into public.event_series (
  id, club_id, title, venue_id, notes, frequency, weekday, nth_week,
  start_time, duration_minutes, table_count, starts_on, ends_on, created_by
) values (
  '55555555-0000-0000-0000-000000000004',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Duration series',
  '11111111-0000-0000-0000-000000000001', '',
  'weekly', extract(dow from current_date)::smallint, null,
  '19:00'::time, 180, 1, current_date - 60, current_date - 20,
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- Two past occurrences and two live future ones -- one hand-set to a
-- non-standard 90 minutes, one left alone. `ends_on` is already in the past
-- (current_date - 20), so the `perform materialize_one_series` at the end of
-- every update_event_series call below opens an empty window and generates
-- nothing here -- these four rows are the only occurrences this series ever
-- has.
insert into public.events
  (club_id, series_id, title, venue_id, notes,
   starts_at, ends_at, occurrence_date, overrides, created_by)
values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000004', 'Duration series',
   '11111111-0000-0000-0000-000000000001', '',
   ((current_date - 30) + time '19:00') at time zone 'America/Chicago',
   ((current_date - 30) + time '22:00') at time zone 'America/Chicago',
   current_date - 30, '{}', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000004', 'Duration series',
   '11111111-0000-0000-0000-000000000001', '',
   ((current_date - 50) + time '19:00') at time zone 'America/Chicago',
   ((current_date - 50) + time '22:00') at time zone 'America/Chicago',
   current_date - 50, '{}', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000004', 'Duration series',
   '11111111-0000-0000-0000-000000000001', '',
   ((current_date + 5) + time '19:00') at time zone 'America/Chicago',
   ((current_date + 5) + time '20:30') at time zone 'America/Chicago',
   current_date + 5, array['starts_at']::text[],
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000004', 'Duration series',
   '11111111-0000-0000-0000-000000000001', '',
   ((current_date + 12) + time '19:00') at time zone 'America/Chicago',
   ((current_date + 12) + time '22:00') at time zone 'America/Chicago',
   current_date + 12, '{}', 'aaaaaaaa-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 13a. new_duration alone, toggle off. Closes x1 (touched_time dropping its
-- eff_dur half) and x2 (make_interval hardcoded to 180) in one assertion,
-- and is also the propagation-path ends_at assertion the review asked for.
select lives_ok(
  $$select public.update_event_series(
      '55555555-0000-0000-0000-000000000004',
      null, null, null, null, 240, null, null, false)$$,
  'series C''s duration alone is changed, toggle off'
);

select is(
  (select to_char(ends_at at time zone 'America/Chicago', 'HH24:MI')
   from public.events where occurrence_date = current_date - 30),
  '22:00',
  'a past week keeps its original 180-minute length'
);

select is(
  (select to_char(ends_at at time zone 'America/Chicago', 'HH24:MI')
   from public.events where occurrence_date = current_date + 5),
  '20:30',
  'a week with a hand-set time keeps its hand-set 90 minutes'
);

select is(
  (select to_char(ends_at at time zone 'America/Chicago', 'HH24:MI')
   from public.events where occurrence_date = current_date + 12),
  '23:00',
  'an un-customised week takes the new 240-minute length'
);

-- The gate that decides whether a title "changed" is trimmed on both sides
-- (20260823040000). Give one live week a title override on top of its
-- starts_at one, so a whitespace-only resend can be told apart from a real
-- edit by whether that override survives.
set local role postgres;
update public.events set overrides = array['starts_at', 'title']::text[]
  where occurrence_date = current_date + 5;
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- 13b. A whitespace-padded resend of the series' own current title, toggle
-- on, is not a change -- the override survives.
select lives_ok(
  $$select public.update_event_series(
      '55555555-0000-0000-0000-000000000004',
      '  Duration series  ', null, null, null, null, null, null, true)$$,
  'the series title is resent padded with whitespace, toggle on'
);

select results_eq(
  $$select overrides from public.events
    where occurrence_date = current_date + 5$$,
  $$values (array['starts_at', 'title']::text[])$$,
  'a whitespace-only resend is not a real change, so the title override survives the toggle'
);

-- 13c. A real title change propagates trimmed.
select lives_ok(
  $$select public.update_event_series(
      '55555555-0000-0000-0000-000000000004',
      '  Brand new title  ', null, null, null, null, null, null, false)$$,
  'the series title is actually changed, padded with whitespace'
);

select is(
  (select title from public.events where occurrence_date = current_date + 12),
  'Brand new title',
  'and the un-overridden week takes it trimmed, not padded'
);

-- 13d. Shortening ends_on, chosen to fall before BOTH past occurrences, so
-- the shortening cancel's own `starts_at > now()` guard -- not the one on the
-- other four propagation statements -- is what has to hold. Closes x3 (the
-- whole branch deleted) and x4 (that guard specifically dropped).
select lives_ok(
  $$select public.update_event_series(
      '55555555-0000-0000-0000-000000000004',
      null, null, null, null, null, null, (current_date - 55), false)$$,
  'series C''s planned end is pulled back before both of its past weeks'
);

select is(
  (select status::text from public.events where occurrence_date = current_date + 5),
  'cancelled',
  'a live future week beyond the shortened end is cancelled'
);

select is(
  (select status::text from public.events where occurrence_date = current_date + 12),
  'cancelled',
  'so is the other one'
);

select isnt(
  (select status::text from public.events where occurrence_date = current_date - 30),
  'cancelled',
  'a past week that also falls beyond the shortened end is NOT cancelled -- shortening a series never rewrites history'
);

select isnt(
  (select status::text from public.events where occurrence_date = current_date - 50),
  'cancelled',
  'nor is the other past week'
);

select is(
  (select materialized_through from public.event_series
   where id = '55555555-0000-0000-0000-000000000004'),
  current_date - 55,
  'materialized_through is pulled back to the new end along with it'
);

-- ---------------------------------------------------------------------------
-- 14. clear_ends_on (20260823080000): the edit screen's "Runs indefinitely"
--     control. `new_ends_on` alone can never express this -- null means
--     "leave alone" for every field in this function, not "clear it" -- so
--     this is a second, distinct signal. Still series C, whose ends_on is
--     current_date - 55 after 13d and whose two future occurrences are
--     already cancelled by it.
-- ---------------------------------------------------------------------------

-- 14a. Clearing with nothing else set.
select lives_ok(
  $$select public.update_event_series(
      '55555555-0000-0000-0000-000000000004',
      null, null, null, null, null, null, null, false, true)$$,
  'the host turns the series back to running indefinitely'
);

select ok(
  (select ends_on from public.event_series
   where id = '55555555-0000-0000-0000-000000000004') is null,
  'ends_on is cleared'
);

-- 14b. Precedence: clear_ends_on wins even if new_ends_on is also sent.
-- Kills a mutant that swaps the ternary's branches, or that ORs the two
-- instead of letting clear_ends_on short-circuit.
select lives_ok(
  $$select public.update_event_series(
      '55555555-0000-0000-0000-000000000004',
      null, null, null, null, null, null,
      (current_date + 100), false, true)$$,
  'clear_ends_on is sent alongside a new_ends_on date'
);

select ok(
  (select ends_on from public.event_series
   where id = '55555555-0000-0000-0000-000000000004') is null,
  'clearing still wins -- the date argument is ignored'
);

-- 14c. Clearing never cancels anything -- there is nothing to cancel when
-- the boundary moves to infinity. The two occurrences 13d already cancelled
-- stay exactly as they were; nothing else joins them.
select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000004'
     and status = 'cancelled'),
  2,
  'clearing the end date cancels nothing new'
);

-- 14d. With clear_ends_on left at its default (false), new_ends_on still
-- behaves normally on an already-null ends_on -- the two parameters do not
-- interfere with each other once clear_ends_on stops being sent.
select lives_ok(
  $$select public.update_event_series(
      '55555555-0000-0000-0000-000000000004',
      null, null, null, null, null, null, (current_date + 200), false, false)$$,
  'an ordinary new_ends_on edit, after the series was cleared'
);

select is(
  (select ends_on from public.event_series
   where id = '55555555-0000-0000-0000-000000000004'),
  current_date + 200,
  'and it is set normally'
);

-- 14e. The guard-shape gap closed for six other functions in
-- 20260823020000 could reopen here: clear_ends_on gives
-- update_event_series a natural call form with a NULL title -- the edit
-- screen's "Runs indefinitely" toggle never touches the name field, so a
-- real client-issued clear-the-end-date call looks exactly like this. The
-- ONLY other organizer-guard assertion for this function (9, above) sends
-- a non-null title ('Bob was here'), so a mutant that guards
-- assert_club_organizer behind `if new_title is not null then ... end if`
-- would satisfy every other assertion in this file while still letting a
-- plain member clear a series' end date outright.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.update_event_series(
      '55555555-0000-0000-0000-000000000004',
      null, null, null, null, null, null, null, false, true)$$,
  '42501',
  'not an organizer of this club',
  'a plain member cannot clear a series end date'
);

select * from finish();
rollback;
