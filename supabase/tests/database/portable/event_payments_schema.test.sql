begin;
set local search_path to extensions, public;

select plan(9);

select has_table('public', 'event_payments', 'event_payments exists');
select has_column('public', 'event_payments', 'event_id',   'has event_id');
select has_column('public', 'event_payments', 'club_id',    'has club_id');
select has_column('public', 'event_payments', 'profile_id', 'has profile_id');
select has_column('public', 'event_payments', 'paid_at',    'has paid_at');
select has_column('public', 'event_payments', 'marked_by',  'has marked_by');

-- One row per person per event: what makes the write idempotent.
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'event_payments'
       and indexdef like '%UNIQUE%(event_id, profile_id)%'),
  'one payment row per person per event');

select ok(
  (select relrowsecurity from pg_class
     where oid = 'public.event_payments'::regclass),
  'row level security is enabled on event_payments');

-- ALL includes TRUNCATE, which ignores RLS entirely.
select ok(
  not has_table_privilege('authenticated', 'public.event_payments', 'TRUNCATE'),
  'authenticated cannot TRUNCATE event_payments');

select * from finish();
rollback;
