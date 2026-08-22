begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(40);

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
   'aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------
-- Date generation, tested directly. No events involved.
-- ---------------------------------------------------------------------

-- Weekly Tuesdays across a month.
select is(
  (select count(*)::int from public.series_occurrence_dates(
     'weekly', 2::smallint, null, '2027-03-01', null,
     '2027-03-01', '2027-03-31')),
  5,
  'March 2027 has five Tuesdays'
);

-- Biweekly is anchored on starts_on, so extending the horizon in two steps
-- must produce the same dates as extending it in one.
select results_eq(
  $$select * from public.series_occurrence_dates(
      'biweekly', 2::smallint, null, '2027-01-01', null,
      '2027-01-01', '2027-02-28')$$,
  $$values ('2027-01-05'::date), ('2027-01-19'), ('2027-02-02'),
           ('2027-02-16')$$,
  'biweekly anchors on the first weekday match after starts_on'
);

select results_eq(
  $$select * from public.series_occurrence_dates(
      'biweekly', 2::smallint, null, '2027-01-01', null,
      '2027-02-01', '2027-02-28')$$,
  $$values ('2027-02-02'::date), ('2027-02-16')$$,
  'a later window keeps the same fortnight, it does not restart it'
);

-- Both windows above open ON the fortnight (2027-01-01 is starts_on itself,
-- and 2027-02-01 is a Monday whose next Tuesday, the 2nd, is on the
-- fortnight either way), so anchoring on the WINDOW instead of on starts_on
-- produced identical dates and neither assertion could tell the difference —
-- verified: rewriting the anchor to lower_bound left both green. This window
-- opens mid-fortnight. The rule's Tuesdays are the 5th and 19th of January;
-- a window opening on the 10th must skip to the 19th, not restart on the
-- 12th.
select results_eq(
  $$select * from public.series_occurrence_dates(
      'biweekly', 2::smallint, null, '2027-01-01', null,
      '2027-01-10', '2027-02-10')$$,
  $$values ('2027-01-19'::date), ('2027-02-02')$$,
  'a window opening mid-fortnight keeps starts_on''s fortnight'
);

-- The 5th Tuesday exists in March, June and August 2027 and nowhere else in
-- that range. A month without one produces nothing, rather than falling back
-- to the 4th — "the 5th Tuesday" means what it says.
select results_eq(
  $$select * from public.series_occurrence_dates(
      'monthly_nth_weekday', 2::smallint, 5::smallint, '2027-01-01',
      '2027-08-31', '2027-01-01', '2027-08-31')$$,
  $$values ('2027-03-30'::date), ('2027-06-29'), ('2027-08-31')$$,
  'a month with no fifth Tuesday yields nothing that month'
);

select is(
  (select count(*)::int from public.series_occurrence_dates(
     'monthly_nth_weekday', 2::smallint, (-1)::smallint, '2027-01-01',
     '2027-08-31', '2027-01-01', '2027-08-31')),
  8,
  'the last Tuesday exists in every month'
);

-- March 2027's Tuesdays are the 2nd, 9th, 16th, 23rd and 30th (verified
-- against extract(dow from ...) directly). ends_on='2027-03-15' cuts the
-- run after the 9th, leaving two, not three -- confirmed by direct
-- execution against the local database.
select is(
  (select count(*)::int from public.series_occurrence_dates(
     'weekly', 2::smallint, null, '2027-03-01', '2027-03-15',
     '2027-03-01', '2027-03-31')),
  2,
  'ends_on truncates the run'
);

-- ---------------------------------------------------------------------
-- Materialization.
-- ---------------------------------------------------------------------
insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  duration_minutes, table_count, starts_on, ends_on, created_by
) values (
  '55555555-0000-0000-0000-000000000001',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
  '11111111-0000-0000-0000-000000000001',
  'weekly', 0::smallint, '19:00', 180, 3,
  '2027-03-01', '2027-03-31',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- A horizon wide enough to reach March 2027 from whenever the suite runs.
select is(
  public.materialize_event_series(
    (date '2027-03-31' - current_date)::int),
  4,
  'four Sundays in March 2027 are materialized'
);

select is(
  (select count(*)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.series_id = '55555555-0000-0000-0000-000000000001'),
  12,
  'each occurrence gets the series table count'
);

-- `count(distinct label) = 3` passed for any three distinct strings. Name the
-- labels and the positions, because the client renders both.
select results_eq(
  $$select t.label, t.position
      from public.event_tables t
      join public.events e on e.id = t.event_id
     where e.series_id = '55555555-0000-0000-0000-000000000001'
       and e.occurrence_date = '2027-03-07'
     order by t.position$$,
  $$values ('Table 1'::text, 1), ('Table 2', 2), ('Table 3', 3)$$,
  'tables are labelled Table 1..n and numbered to match'
);

-- Both of these arrive from column defaults today. Pinning them here means a
-- future change to the defaults has to be a deliberate one: the plan's
-- requirement is four seats and a mixed tier, not "whatever the schema says".
select is(
  (select count(*)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.series_id = '55555555-0000-0000-0000-000000000001'
     and t.capacity <> 4),
  0,
  'every materialized table seats four'
);

select is(
  (select count(*)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.series_id = '55555555-0000-0000-0000-000000000001'
     and t.skill_tier <> 'mixed'),
  0,
  'every materialized table is mixed-tier'
);

-- Idempotency: running it again inserts nothing.
select is(
  public.materialize_event_series(
    (date '2027-03-31' - current_date)::int),
  0,
  'a second run creates nothing'
);

select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'),
  4,
  'and leaves the occurrence count alone'
);

-- A cancelled week is not resurrected: its row still occupies the slot.
update public.events set status = 'cancelled'
  where series_id = '55555555-0000-0000-0000-000000000001'
    and occurrence_date = '2027-03-14';

update public.event_series set materialized_through = null
  where id = '55555555-0000-0000-0000-000000000001';

select is(
  public.materialize_event_series(
    (date '2027-03-31' - current_date)::int),
  0,
  'rewinding the horizon does not recreate a cancelled week'
);

select is(
  (select status::text from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'
     and occurrence_date = '2027-03-14'),
  'cancelled',
  'the cancelled week stays cancelled'
);

-- Idempotency is answered by the partial unique index, not by
-- materialized_through's bookkeeping. The sweep hides that distinction: it
-- wraps each series in an exception block, so an insert that raised on a
-- duplicate would be swallowed and still report "created 0". Re-run the
-- SINGLE-series path, which propagates, over dates that already have rows.
-- Removing `on conflict ... do nothing` entirely, or turning it into a
-- `do update` that returns the existing id and so re-inserts that event's
-- tables, both left every other assertion in this file green.
update public.event_series set materialized_through = null
  where id = '55555555-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.materialize_one_series(
      '55555555-0000-0000-0000-000000000001',
      (date '2027-03-31' - current_date)::int)$$,
  'the propagating path re-walks materialized dates without raising'
);

-- ---------------------------------------------------------------------
-- DST. The whole reason the rule is stored club-local.
-- ---------------------------------------------------------------------
-- US DST begins 2027-03-14. The series above spans it: 2027-03-07 is EST
-- (UTC-5) and 2027-03-14 is EDT (UTC-4). Both must read 19:00 locally.
select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'
     and to_char(starts_at at time zone 'America/New_York', 'HH24:MI')
         <> '19:00'),
  0,
  'every occurrence is 19:00 club-local, on both sides of the shift'
);

-- And prove it is not a fixed offset hiding behind that assertion.
select isnt(
  (select starts_at at time zone 'UTC' from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'
     and occurrence_date = '2027-03-07')::time,
  (select starts_at at time zone 'UTC' from public.events
   where series_id = '55555555-0000-0000-0000-000000000001'
     and occurrence_date = '2027-03-14')::time,
  'the UTC instant shifts by an hour across the DST boundary'
);

-- The two pathological cases, pinned rather than fixed. A club that plays at
-- 02:30 does not exist; a test that documents what Postgres does is cheaper
-- than a feature nobody needs.
select is(
  (timestamp '2027-03-14 02:30' at time zone 'America/New_York')
    at time zone 'America/New_York',
  timestamp '2027-03-14 03:30',
  'a start time inside the spring-forward gap resolves forward'
);

-- Wall-clock 01:30 on 2027-11-07 occurs twice: once at 05:30 UTC (still
-- EDT, before the fall back) and again at 06:30 UTC (EST, after it).
-- Verified directly against the local database: Postgres's `at time zone`
-- resolves the ambiguous naive timestamp to the LATER of the two instants
-- (standard time), not the earlier one -- pin what it actually does, not
-- what seems intuitive.
select is(
  timestamp '2027-11-07 01:30' at time zone 'America/New_York',
  timestamptz '2027-11-07 06:30+00',
  'a start time inside the fall-back repeat resolves to standard time'
);

-- ---------------------------------------------------------------------
-- The other two frequencies, driven through materialization.
--
-- The date function is tested directly above, but until now only `weekly`
-- had ever been run through materialize_event_series. Both other paths
-- worked; nothing pinned them.
-- ---------------------------------------------------------------------
insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, nth_week, start_time,
  duration_minutes, table_count, starts_on, ends_on, created_by
) values (
  '55555555-0000-0000-0000-000000000002',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Fortnightly Tuesdays',
  '11111111-0000-0000-0000-000000000001',
  'biweekly', 2::smallint, null, '19:00', 180, 1,
  '2027-06-01', '2027-07-31',
  'aaaaaaaa-0000-0000-0000-000000000001'
), (
  '55555555-0000-0000-0000-000000000003',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Second Saturday',
  '11111111-0000-0000-0000-000000000001',
  'monthly_nth_weekday', 6::smallint, 2::smallint, '13:00', 180, 1,
  '2027-09-01', null,
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- The March series is already materialized to its ends_on, so it
-- contributes nothing: five fortnightly Tuesdays plus four second
-- Saturdays.
select is(
  public.materialize_event_series(
    (date '2027-12-31' - current_date)::int),
  9,
  'the sweep materializes biweekly and monthly series too'
);

select results_eq(
  $$select occurrence_date from public.events
     where series_id = '55555555-0000-0000-0000-000000000002'
     order by occurrence_date$$,
  $$values ('2027-06-01'::date), ('2027-06-15'), ('2027-06-29'),
           ('2027-07-13'), ('2027-07-27')$$,
  'the biweekly fortnight survives the trip through materialization'
);

select results_eq(
  $$select occurrence_date from public.events
     where series_id = '55555555-0000-0000-0000-000000000003'
     order by occurrence_date$$,
  $$values ('2027-09-11'::date), ('2027-10-09'), ('2027-11-13'),
           ('2027-12-11')$$,
  'the monthly series lands on the second Saturday of each month'
);

-- The fortnight must survive a horizon extended in TWO steps. Every biweekly
-- assertion above materializes in one go, and the second step is the only
-- thing that ever hands the date function a window opening mid-fortnight
-- (window_start is materialized_through + 1). Verified: passing window_start
-- to the function as the anchor instead of starts_on left the whole file
-- green, and would have moved this club's game to 06-22, 07-06 and 07-20.
insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  duration_minutes, table_count, starts_on, ends_on, created_by
) values (
  '55555555-0000-0000-0000-000000000008',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Fortnightly, in two steps',
  '11111111-0000-0000-0000-000000000001',
  'biweekly', 2::smallint, '19:00', 180, 1,
  '2027-06-01', '2027-07-31',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- Setup, not assertions: a short horizon that stops on 2027-06-20, then one
-- that reaches ends_on. The second run's window opens on 2027-06-21, a
-- Monday, and the next Tuesday after it is the 22nd -- the wrong fortnight.
do $two_steps$
begin
  perform public.materialize_one_series(
    '55555555-0000-0000-0000-000000000008',
    (date '2027-06-20' - current_date)::int);
  perform public.materialize_one_series(
    '55555555-0000-0000-0000-000000000008',
    (date '2027-07-31' - current_date)::int);
end
$two_steps$;

select results_eq(
  $$select occurrence_date from public.events
     where series_id = '55555555-0000-0000-0000-000000000008'
     order by occurrence_date$$,
  $$values ('2027-06-01'::date), ('2027-06-15'), ('2027-06-29'),
           ('2027-07-13'), ('2027-07-27')$$,
  'extending the horizon in two steps yields the dates one step would have'
);

-- ---------------------------------------------------------------------
-- materialized_through. "Covered up to here", not "created up to here".
-- ---------------------------------------------------------------------
select is(
  (select materialized_through from public.event_series
   where id = '55555555-0000-0000-0000-000000000003'),
  date '2027-12-31',
  'materialized_through advances to the end of the horizon'
);

select is(
  (select materialized_through from public.event_series
   where id = '55555555-0000-0000-0000-000000000002'),
  date '2027-07-31',
  'ends_on caps materialized_through short of the horizon'
);

-- ---------------------------------------------------------------------
-- The current_date floor.
--
-- Before it, the first materialization of a series whose rule reaches into
-- the past generated the whole of that past: this series produced 111
-- events, 104 of them already over. This app schedules games; it does not
-- backfill games that never happened.
-- ---------------------------------------------------------------------
insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  duration_minutes, table_count, starts_on, created_by
) values (
  '55555555-0000-0000-0000-000000000004',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Running for two years',
  '11111111-0000-0000-0000-000000000001',
  -- 728 days is exactly 104 weeks, so starts_on shares today's weekday and
  -- an unfloored run would have produced 105 occurrences.
  'weekly', extract(dow from current_date)::smallint, '19:00', 180, 1,
  current_date - 728,
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- Every other series is already materialized past this horizon, so the
-- count is this series' alone: today, and today + 7.
select is(
  public.materialize_event_series(13),
  2,
  'a two-year-old series materializes only the fortnight ahead'
);

select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000004'
     and occurrence_date < current_date),
  0,
  'no occurrence is backfilled into the past'
);

select is(
  (select min(occurrence_date) from public.events
   where series_id = '55555555-0000-0000-0000-000000000004'),
  current_date,
  'today itself still materializes -- a game this evening is not past'
);

select is(
  (select materialized_through from public.event_series
   where id = '55555555-0000-0000-0000-000000000004'),
  current_date + 13,
  'the floor does not hold materialized_through back from the horizon'
);

-- A series created today, for today. The floor must not swallow it.
insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  duration_minutes, table_count, starts_on, ends_on, created_by
) values (
  '55555555-0000-0000-0000-000000000005',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Starting today',
  '11111111-0000-0000-0000-000000000001',
  'weekly', extract(dow from current_date)::smallint, '19:00', 180, 1,
  current_date, current_date,
  'aaaaaaaa-0000-0000-0000-000000000001'
);

select is(
  public.materialize_one_series(
    '55555555-0000-0000-0000-000000000005', 42),
  1,
  'a series starting today creates today''s occurrence'
);

select is(
  (select materialized_through from public.event_series
   where id = '55555555-0000-0000-0000-000000000005'),
  current_date,
  'and ends_on caps its coverage at today'
);

-- ---------------------------------------------------------------------
-- Timezone validation, and containment for the rows that predate it.
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.clubs (name, slug, timezone, created_by)
    values ('Nowhere', 'nowhere-club', 'Nowhere/Fake',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '22023',
  'unrecognized timezone: Nowhere/Fake',
  'a club cannot be created with a zone Postgres does not know'
);

select throws_ok(
  $$update public.clubs set timezone = 'Mars/Olympus'
     where id = 'c1c1c1c1-0000-0000-0000-000000000001'$$,
  '22023',
  'unrecognized timezone: Mars/Olympus',
  'nor edited into one'
);

select lives_ok(
  $$insert into public.clubs (name, slug, timezone, created_by)
    values ('Londoners', 'londoners', 'Europe/London',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'a real IANA zone is still accepted'
);

-- Defence in depth. With the trigger in place this row is unreachable
-- through any normal write, which is why the test has to force it past the
-- trigger to reach the handler at all. Rows written before this migration
-- are not so lucky, and neither is anything else that can fail mid-sweep.
alter table public.clubs disable trigger clubs_validate_timezone;
insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000009', 'Nowhere', 'nowhere-club',
   'Nowhere/Fake', 'aaaaaaaa-0000-0000-0000-000000000001');
alter table public.clubs enable trigger clubs_validate_timezone;

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000009', 'Nowhere Hall',
   'c1c1c1c1-0000-0000-0000-000000000009',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  duration_minutes, table_count, starts_on, created_by
) values (
  '55555555-0000-0000-0000-000000000006',
  'c1c1c1c1-0000-0000-0000-000000000009', 'Doomed',
  '11111111-0000-0000-0000-000000000009',
  'weekly', extract(dow from current_date)::smallint, '19:00', 180, 1,
  current_date, 'aaaaaaaa-0000-0000-0000-000000000001'
), (
  '55555555-0000-0000-0000-000000000007',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Healthy neighbour',
  '11111111-0000-0000-0000-000000000001',
  'weekly', extract(dow from current_date)::smallint, '19:00', 180, 1,
  current_date, 'aaaaaaaa-0000-0000-0000-000000000001'
);

-- A six-day horizon reaches only today for both new series; every older
-- series is already covered further out. Before containment this call
-- raised and rolled back the entire sweep.
select is(
  public.materialize_event_series(6),
  1,
  'one club''s unusable timezone no longer aborts the sweep'
);

select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000007'),
  1,
  'the healthy club''s occurrence is created anyway'
);

select is(
  (select count(*)::int from public.events
   where series_id = '55555555-0000-0000-0000-000000000006'),
  0,
  'and the unusable series simply produced nothing'
);

-- The other half of the choice: the single-series entry point that a host's
-- synchronous create/edit uses does NOT swallow the error, so a host is
-- never told a series was created when it was not.
select throws_ok(
  $$select public.materialize_one_series(
      '55555555-0000-0000-0000-000000000006', 6)$$,
  '22023',
  'time zone "Nowhere/Fake" not recognized',
  'the single-series path surfaces the failure to its caller'
);

select * from finish();
rollback;
