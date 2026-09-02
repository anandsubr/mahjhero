begin;
set local search_path to extensions, public;

select plan(3);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status, joined_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active',
   now() - interval '30 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active',
   now() - interval '30 days');

insert into public.message_threads (id, club_id, created_by, last_message_at) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 day');

-- Two posts by Alice, one reply each. Four messages Bob has not read.
insert into public.messages (id, thread_id, author_id, body, created_at,
                             reply_count, last_reply_at) values
  ('aa000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Post one',
   now() - interval '5 days', 1, now() - interval '4 days'),
  ('cc000000-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Post two',
   now() - interval '2 days', 1, now() - interval '1 day');

insert into public.messages (id, thread_id, author_id, body, root_id, created_at) values
  ('a1000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'reply one',
   'aa000000-0000-0000-0000-00000000000a', now() - interval '4 days'),
  ('c1000000-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'reply two',
   'cc000000-0000-0000-0000-00000000000c', now() - interval '1 day');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select unread from public.fetch_my_threads()
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001' and kind = 'club'),
  4,
  'the club row totals every unread message across every post'
);

select lives_ok(
  $$ select public.mark_post_read('aa000000-0000-0000-0000-00000000000a') $$,
  'Bob reads post one'
);

select is(
  (select unread from public.fetch_my_threads()
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001' and kind = 'club'),
  2,
  'reading one post subtracts only that post — mark_thread_read is not involved'
);

select * from finish();
rollback;
