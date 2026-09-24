begin;
set local search_path to extensions, public;

select plan(4);

select has_column('public', 'profiles', 'dismissed_guides', 'profiles has dismissed_guides');
select col_type_is('public', 'profiles', 'dismissed_guides', 'text[]', 'dismissed_guides is text[]');
select col_not_null('public', 'profiles', 'dismissed_guides', 'dismissed_guides is not null');

-- profiles UPDATE is column-granted (20260903160000); a column missing from
-- that grant is unwritable from the client no matter what RLS says.
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'dismissed_guides', 'UPDATE'),
  'authenticated may update dismissed_guides');

select * from finish();
rollback;
