begin;
set local search_path to extensions, public;

select plan(10);

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

select * from finish();
rollback;
