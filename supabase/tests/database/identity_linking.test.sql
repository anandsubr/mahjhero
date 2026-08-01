begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(4);

-- ---------------------------------------------------------------------------
-- Part 1: the trigger absorbs a conflicting profile instead of failing.
--
-- Seed a profile row FIRST, then create the auth user with the same id. The
-- trigger fires into an id that already exists, which is the only way to
-- exercise `on conflict (id) do nothing`. Delete that clause from
-- handle_new_user() and the insert below raises a unique violation, so
-- these assertions genuinely fail.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, display_name)
values ('33333333-3333-3333-3333-333333333333', 'Existing Carol');

select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data)
    values ('33333333-3333-3333-3333-333333333333', 'carol@example.com',
            '{"full_name": "New Carol"}'::jsonb)$$,
  'creating an auth user whose profile already exists does not raise'
);

select is(
  (select count(*)::int from public.profiles
   where id = '33333333-3333-3333-3333-333333333333'),
  1,
  'still exactly one profile for that id'
);

select is(
  (select display_name from public.profiles
   where id = '33333333-3333-3333-3333-333333333333'),
  'Existing Carol',
  'the existing profile is preserved, not overwritten by the trigger'
);

-- ---------------------------------------------------------------------------
-- Part 2: the platform guarantee this design leans on.
--
-- `on conflict (id)` cannot stop two DIFFERENT ids sharing one email — that
-- is prevented by auth.users itself. Assert it, so we find out if that ever
-- stops being true rather than discovering it through duplicated members.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'dave@example.com');

select throws_ok(
  $$insert into auth.users (id, email)
    values ('55555555-5555-5555-5555-555555555555', 'dave@example.com')$$,
  '23505',
  null,
  'auth.users rejects a second user with the same email'
);

select * from finish();
rollback;
