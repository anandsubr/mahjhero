begin;
set local search_path to extensions, public;

select plan(4);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'guide-alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-0000000000d2', 'guide-bob@example.com');

select is(
  (select dismissed_guides from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-0000000000d1'),
  '{}'::text[],
  'a new profile starts with nothing dismissed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-0000000000d1", "role": "authenticated"}';

update public.profiles set dismissed_guides = array['player-intro']
 where id = 'aaaaaaaa-0000-0000-0000-0000000000d1';

select is(
  (select dismissed_guides from public.profiles
    where id = 'aaaaaaaa-0000-0000-0000-0000000000d1'),
  array['player-intro'],
  'a member can write their own dismissed_guides');

-- RLS makes another member's row invisible to the update: zero rows, no error.
update public.profiles set dismissed_guides = array['tip:event']
 where id = 'bbbbbbbb-0000-0000-0000-0000000000d2';

reset role;

select is(
  (select dismissed_guides from public.profiles
    where id = 'bbbbbbbb-0000-0000-0000-0000000000d2'),
  '{}'::text[],
  'a member cannot write someone else''s dismissed_guides');

-- The grant must stay column-scoped: adding dismissed_guides must not have
-- reopened is_admin.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE'),
  'is_admin is still not client-writable');

select * from finish();
rollback;
