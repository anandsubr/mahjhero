begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(8);

-- Structure
select has_table('public', 'profiles', 'profiles table exists');
select has_column('public', 'profiles', 'quiet_hours_start', 'has quiet_hours_start');
select has_column('public', 'profiles', 'mute_need_a_fourth', 'has mute_need_a_fourth');

-- A profile row is created automatically for a new auth user
insert into auth.users (id, email, raw_user_meta_data)
values (
  '11111111-1111-1111-1111-111111111111',
  'alice@example.com',
  '{"full_name": "Alice"}'::jsonb
);

select is(
  (select display_name from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  'Alice',
  'profile is auto-created with display_name from user metadata'
);

select is(
  (select quiet_hours_start from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  '21:00'::time,
  'quiet hours default to 21:00'
);

select is(
  (select quiet_hours_enabled from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  true,
  'quiet hours default to enabled'
);

-- RLS: a member reads their own profile and no one else's
insert into auth.users (id, email)
values ('22222222-2222-2222-2222-222222222222', 'bob@example.com');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

select is(
  (select count(*)::int from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'),
  1,
  'member can read their own profile'
);

select is(
  (select count(*)::int from public.profiles
   where id = '22222222-2222-2222-2222-222222222222'),
  0,
  'member cannot read another profile'
);

select * from finish();
rollback;
