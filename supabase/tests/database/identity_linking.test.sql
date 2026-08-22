begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(2);

-- ---------------------------------------------------------------------------
-- What is NOT tested here, and why.
--
-- `handle_new_user()` carries `on conflict (id) do nothing`. That branch is
-- structurally unreachable and therefore untestable: profiles.id references
-- auth.users(id) non-deferrably, so a profile cannot exist before its auth
-- user; auth.users.id is a primary key, so the same id cannot be inserted
-- twice to re-fire the trigger; and deleting the user cascades the profile
-- away rather than orphaning it. The clause stays as cheap insurance against
-- a future schema change, but no test can exercise it, and a test that
-- claims to is worse than none — an earlier version of this file made
-- exactly that false claim.
--
-- The two guarantees below are the ones that actually hold the identity
-- model together, and both genuinely fail if broken.
-- ---------------------------------------------------------------------------

-- 1. One verified email cannot become two accounts. This is what prevents a
--    member appearing twice on a club roster with their bookings split.
insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'dave@example.com');

select throws_ok(
  $$insert into auth.users (id, email)
    values ('55555555-5555-5555-5555-555555555555', 'dave@example.com')$$,
  '23505',
  null,
  'auth.users rejects a second user with the same email'
);

-- 2. Removing an auth user removes their profile. Without the cascade, a
--    deleted account leaves an orphaned profile that still appears on
--    rosters and in bookings.
insert into auth.users (id, email)
values ('66666666-6666-6666-6666-666666666666', 'erin@example.com');

delete from auth.users where id = '66666666-6666-6666-6666-666666666666';

select is(
  (select count(*)::int from public.profiles
   where id = '66666666-6666-6666-6666-666666666666'),
  0,
  'deleting an auth user cascades to their profile, leaving no orphan'
);

select * from finish();
rollback;
