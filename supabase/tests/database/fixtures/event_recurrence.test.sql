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

select is(
  (select count(distinct label)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.series_id = '55555555-0000-0000-0000-000000000001'),
  3,
  'tables are labelled Table 1..n'
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

select * from finish();
rollback;
