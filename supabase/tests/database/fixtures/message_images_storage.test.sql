begin;
set local search_path to extensions, public;

select plan(5);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active');

insert into public.message_threads (id, club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

select ok(
  (select bool_or(id = 'message-images') from storage.buckets),
  'message-images bucket exists'
);

select ok(
  not (select public from storage.buckets where id = 'message-images'),
  'message-images bucket is private'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- Alice is a Riverside member: she can write under that thread's folder.
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('message-images',
             '11111111-0000-0000-0000-000000000001/pic.jpg',
             'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'a thread member can write under the thread''s own folder'
);

set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

-- Bob is not a Riverside member: the insert policy denies him, so the row
-- is silently not inserted rather than an exception -- RLS WITH CHECK
-- failures raise 42501 under `insert`, which throws_ok below asserts.
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('message-images',
             '11111111-0000-0000-0000-000000000001/intruder.jpg',
             'bbbbbbbb-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'a non-member cannot write under another thread''s folder'
);

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'message-images'
      and name = '11111111-0000-0000-0000-000000000001/pic.jpg'),
  0,
  'a non-member reading that folder sees nothing'
);

select * from finish();
rollback;
