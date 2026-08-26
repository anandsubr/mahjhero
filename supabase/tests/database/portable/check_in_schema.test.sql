begin;
set local search_path to extensions, public;

select plan(12);

select has_table('public', 'check_ins', 'check_ins exists');

select has_column('public', 'check_ins', 'event_id',    'has event_id');
select has_column('public', 'check_ins', 'club_id',     'has club_id');
select has_column('public', 'check_ins', 'profile_id',  'has profile_id');
select has_column('public', 'check_ins', 'state',       'has state');
select has_column('public', 'check_ins', 'recorded_by', 'has recorded_by');
select has_column('public', 'check_ins', 'recorded_at', 'has recorded_at');

select col_type_is('public', 'check_ins', 'state', 'attendance_state',
  'state is the attendance_state enum');

-- The enum has exactly two values. A third would mean somebody added a
-- 'late' state the design rejected on purpose.
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'attendance_state'),
  array['arrived', 'no_show'],
  'attendance_state has exactly arrived and no_show');

-- One row per person per event. This is what makes the write idempotent.
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'check_ins'
       and indexdef like '%UNIQUE%(event_id, profile_id)%'),
  'one check-in per person per event');

select ok(
  (select relrowsecurity from pg_class
     where oid = 'public.check_ins'::regclass),
  'row level security is enabled on check_ins');

-- The whole reason grants.test.sql exists: ALL includes TRUNCATE, which
-- ignores RLS entirely.
select ok(
  not has_table_privilege('authenticated', 'public.check_ins', 'TRUNCATE'),
  'authenticated cannot TRUNCATE check_ins');

select * from finish();
rollback;
