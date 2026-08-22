begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(17);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'Marie''s place',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- A weekly Tuesday series a year out, so every occurrence is "future" no
-- matter when the suite runs.
select lives_ok(
  $$select public.create_event_series(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Weekly game',
      '11111111-0000-0000-0000-000000000001', '',
      'weekly', 2::smallint, null, '19:00'::time, 180, 2,
      (current_date + 365), (current_date + 400))$$,
  'an organizer can create a series'
);

-- Creation materializes in the same transaction, so a host never sees an
-- empty series. The horizon is six weeks, and the series starts beyond it —
-- so nothing is materialized yet, which is correct and is asserted so the
-- next assertion's zero is not mistaken for a bug.
select is(
  (select count(*)::int from public.events
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  0,
  'a series starting beyond the horizon materializes nothing yet'
);

-- Bring the horizon out to cover it.
set local role postgres;
select public.materialize_event_series(420);

select cmp_ok(
  (select count(*)::int from public.events
   where series_id = (select id from public.event_series limit 1)),
  '>=',
  5,
  'the series materializes once the horizon reaches it'
);

-- Override the venue on exactly one occurrence.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event(
      (select id from public.events order by starts_at limit 1),
      null, '11111111-0000-0000-0000-000000000002', null, null, null)$$,
  'one occurrence is moved to a different venue'
);

-- Cancel a different one, to prove cancellation is never touched.
select lives_ok(
  $$select public.cancel_event(
      (select id from public.events order by starts_at offset 1 limit 1))$$,
  'a different occurrence is cancelled'
);

-- ---------------------------------------------------------------------
-- The default: skip the overridden field, reach everything else.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series limit 1),
      'Renamed game', null, null, '18:30'::time, null, null, null, false)$$,
  'the series title and start time are changed'
);

select is(
  (select venue_id from public.events order by starts_at limit 1),
  '11111111-0000-0000-0000-000000000002'::uuid,
  'the relocated week keeps its venue'
);

select is(
  (select title from public.events order by starts_at limit 1),
  'Renamed game',
  'the relocated week still takes the new title'
);

select is(
  (select to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
   from public.events order by starts_at limit 1),
  '18:30',
  'the relocated week still takes the new start time'
);

select is(
  (select title from public.events order by starts_at offset 1 limit 1),
  'Weekly game',
  'the cancelled week is not touched'
);

select is(
  (select count(*)::int from public.events
   where to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
         <> '18:30'
     and status <> 'cancelled'),
  0,
  'every live occurrence moved to the new time'
);

-- ---------------------------------------------------------------------
-- The opt-in: apply to the overridden ones too, and clear only the fields
-- this edit touched.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series limit 1),
      null, '11111111-0000-0000-0000-000000000001', null, null, null, null,
      null, true)$$,
  'the series venue is changed with the override toggle on'
);

select is(
  (select venue_id from public.events order by starts_at limit 1),
  '11111111-0000-0000-0000-000000000001'::uuid,
  'the relocated week is pulled back to the series venue'
);

select results_eq(
  $$select overrides from public.events order by starts_at limit 1$$,
  $$values (array[]::text[])$$,
  'and its venue override is cleared'
);

-- ---------------------------------------------------------------------
-- Ending a series.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.end_event_series(
      (select id from public.event_series limit 1), true)$$,
  'an organizer can end a series and cancel its future occurrences'
);

select is(
  (select count(*)::int from public.events
   where starts_at > now() and status <> 'cancelled'),
  0,
  'no live future occurrence survives ending the series'
);

-- ---------------------------------------------------------------------
-- The club-timezone reflow: wall clock is preserved, everywhere.
-- ---------------------------------------------------------------------
set local role postgres;

-- A fresh one-off, rather than resurrecting a cancelled occurrence: the
-- cancelled week never took the series' new 18:30, so un-cancelling it would
-- make this assertion fail against perfectly correct code. A one-off is also
-- the case the wall-clock rule exists for — it has no series rule to
-- recompute from, so an implementation that recomputed from the series would
-- silently skip it.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e9e9e9e9-0000-0000-0000-000000000009',
   'c1c1c1c1-0000-0000-0000-000000000001', 'One-off game',
   '11111111-0000-0000-0000-000000000001',
   ((current_date + 400) + time '18:30') at time zone 'America/New_York',
   ((current_date + 400) + time '21:30') at time zone 'America/New_York',
   'aaaaaaaa-0000-0000-0000-000000000001');

update public.clubs set timezone = 'America/Chicago'
  where id = 'c1c1c1c1-0000-0000-0000-000000000001';

select is(
  (select to_char(starts_at at time zone 'America/Chicago', 'HH24:MI')
   from public.events where id = 'e9e9e9e9-0000-0000-0000-000000000009'),
  '18:30',
  'a timezone correction preserves the wall clock, one-off events included'
);

select * from finish();
rollback;
