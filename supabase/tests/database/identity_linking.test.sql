begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(2);

-- One auth user, two verified identities for the same address
-- (as happens when someone signs up by magic link then uses Google).
insert into auth.users (id, email)
values ('33333333-3333-3333-3333-333333333333', 'carol@example.com');

insert into auth.identities (id, user_id, provider, provider_id, identity_data)
values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333',
   'email', 'carol@example.com',
   '{"sub": "carol@example.com", "email": "carol@example.com"}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000000002',
   '33333333-3333-3333-3333-333333333333',
   'google', 'google-oauth-subject-1',
   '{"sub": "google-oauth-subject-1", "email": "carol@example.com"}'::jsonb);

select is(
  (select count(*)::int from public.profiles
   where id = '33333333-3333-3333-3333-333333333333'),
  1,
  'two identities on one user still yield exactly one profile'
);

select is(
  (select count(distinct u.id)::int
   from auth.users u
   where u.email = 'carol@example.com'),
  1,
  'one verified email maps to exactly one auth user'
);

select * from finish();
rollback;
