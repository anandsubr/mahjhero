begin;
set local search_path to extensions, public;

select plan(10);

select has_column('public', 'events', 'seating_mode', 'events has seating_mode');
select has_column('public', 'events', 'capacity', 'events has capacity');
select has_column('public', 'event_series', 'seating_mode',
  'event_series has seating_mode');
select has_column('public', 'event_series', 'capacity',
  'event_series has capacity');

select col_type_is('public', 'events', 'seating_mode', 'seating_mode',
  'events.seating_mode is the seating_mode enum');

-- Exactly two values. A third would mean somebody added a mode the design
-- did not ask for.
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'seating_mode'),
  array['assigned_tables', 'open_seating'],
  'seating_mode has exactly assigned_tables and open_seating');

-- Existing rows must be untouched: the default backfills them.
select col_default_is('public', 'events', 'seating_mode', 'assigned_tables',
  'events.seating_mode defaults to assigned_tables');
select col_is_null('public', 'events', 'capacity',
  'events.capacity is nullable — null means uncapped');

-- Both new override keys are registered, or update_event cannot write them.
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'events_overrides_known_keys')
  like '%seating_mode%',
  'seating_mode is an allowed override key');
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'events_overrides_known_keys')
  like '%capacity%',
  'capacity is an allowed override key');

select * from finish();
rollback;
