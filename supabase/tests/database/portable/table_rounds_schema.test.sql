begin;
set local search_path to extensions, public;

select plan(11);

select has_table('public', 'table_rounds', 'table_rounds exists');

select has_column('public', 'table_rounds', 'event_table_id',    'has event_table_id');
select has_column('public', 'table_rounds', 'event_id',          'has event_id');
select has_column('public', 'table_rounds', 'club_id',           'has club_id');
select has_column('public', 'table_rounds', 'winner_profile_id', 'has winner_profile_id');
select has_column('public', 'table_rounds', 'points',            'has points');
select has_column('public', 'table_rounds', 'recorded_by',       'has recorded_by');
select has_column('public', 'table_rounds', 'created_at',        'has created_at');

select ok(
  (select relrowsecurity from pg_class
     where oid = 'public.table_rounds'::regclass),
  'row level security is enabled on table_rounds'
);

-- The whole reason grants.test.sql exists: ALL includes TRUNCATE, which
-- ignores RLS entirely.
select ok(
  not has_table_privilege('authenticated', 'public.table_rounds', 'TRUNCATE'),
  'authenticated cannot TRUNCATE table_rounds'
);

-- `points` is a fixed set (25/30/35/40/45/50/75), not any positive integer
-- (supabase/migrations/20260903070000_record_round_fixed_points.sql) --
-- record_round's own raise is a friendly mapped message, but this
-- constraint is the actual backstop a direct RPC/insert cannot get past.
-- pgTAP has no built-in "constraint matches this expression" assertion, so
-- this wraps a query against `pg_get_constraintdef` in a plain `ok()`.
-- Postgres canonicalises `points in (...)` to `points = ANY (ARRAY[...])`
-- in the constraint's deparsed definition -- confirmed by creating a
-- throwaway table with the exact same check against this project's own
-- linked database (`npx supabase db query --linked`) and reading back
-- `pg_get_constraintdef`, rather than guessed at with a regex.
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
     where conrelid = 'public.table_rounds'::regclass
       and conname = 'table_rounds_points_check')
    = 'CHECK ((points = ANY (ARRAY[25, 30, 35, 40, 45, 50, 75])))',
  'points check constraint enforces the fixed set'
);

select * from finish();
rollback;
