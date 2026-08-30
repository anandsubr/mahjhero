begin;
set local search_path to extensions, public;

select plan(11);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com');

update public.profiles set display_name = 'Alice Ng'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Bob Ruiz'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

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

insert into public.message_threads (id, club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- Two roots by Alice, each with one reply by Alice. Timestamps are seeded
-- EXPLICITLY: now() is transaction-constant, so a fixture that relies on
-- insert order for ordering assertions proves nothing.
insert into public.messages (id, thread_id, author_id, body, created_at,
                             reply_count, last_reply_at) values
  ('aa000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Older post',
   now() - interval '5 days', 1, now() - interval '4 days'),
  ('cc000000-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Newer post',
   now() - interval '2 days', 1, now() - interval '1 day');

insert into public.messages (id, thread_id, author_id, body, root_id, created_at) values
  ('a1000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'reply to older',
   'aa000000-0000-0000-0000-00000000000a', now() - interval '4 days'),
  ('c1000000-0000-0000-0000-00000000000c',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'reply to newer',
   'cc000000-0000-0000-0000-00000000000c', now() - interval '1 day');

-- A game thread and a group thread, both readable by Bob, neither a board
-- (20260830021000). Shaped like thread_predicates.test.sql's game thread:
-- a venue, a published event, a booking group and Bob's own confirmed
-- booking, which is what lets Bob's can_read_thread pass on the game
-- thread without a club_members row of his own to floor against.
insert into public.venues (id, name, added_by_club_id, created_by) values
  ('b1b1b1b1-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           status, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday Night',
   'b1b1b1b1-0000-0000-0000-000000000001',
   now() + interval '2 days', now() + interval '2 days 3 hours',
   'published', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.bookings (group_id, event_id, club_id, profile_id,
                             booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed');

insert into public.message_threads (id, club_id, event_id) values
  ('22222222-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001');

insert into public.message_threads (id, title, created_by) values
  ('33333333-0000-0000-0000-000000000003', 'Tuesday four',
   'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.thread_members (thread_id, profile_id) values
  ('33333333-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001')),
  2,
  'the board lists roots only, never replies'
);

select is(
  (select id from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001') limit 1),
  'cc000000-0000-0000-0000-00000000000c'::uuid,
  'most recent activity sorts first'
);

select is(
  (select author_name from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001') limit 1),
  'Alice Ng',
  'the board resolves a sender name RLS would not'
);

select is_empty(
  $$ select display_name from public.profiles
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'and a plain read of that profile, as Bob, returns nothing at all'
);

-- Everything is unread: Bob has read neither post. Each post counts its own
-- root plus its own replies.
select is(
  (select unread from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001')
    where id = 'aa000000-0000-0000-0000-00000000000a'),
  2,
  'an unopened post counts its root and its replies'
);

select lives_ok(
  $$ select public.mark_post_read('aa000000-0000-0000-0000-00000000000a') $$,
  'a member can mark one post read'
);

select is(
  (select unread from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001')
    where id = 'aa000000-0000-0000-0000-00000000000a'),
  0,
  'reading a post clears its own unread'
);

select is(
  (select unread from public.fetch_club_posts(
     '11111111-0000-0000-0000-000000000001')
    where id = 'cc000000-0000-0000-0000-00000000000c'),
  2,
  'and leaves every OTHER post untouched — the whole point of post_reads'
);

-- Bob can read the game thread (a confirmed seat) and the group thread (a
-- member), so these two reach fetch_club_posts' own guard rather than being
-- turned away earlier by can_read_thread — the case 20260830020000's
-- comment claimed and 20260830021000 actually makes true.
select throws_ok(
  $$ select * from public.fetch_club_posts(
       '22222222-0000-0000-0000-000000000002') $$,
  '22023',
  'only a club has posts to list',
  'a game thread has no board — refused, not handed back as every message relabelled a root'
);

select throws_ok(
  $$ select * from public.fetch_club_posts(
       '33333333-0000-0000-0000-000000000003') $$,
  '22023',
  'only a club has posts to list',
  'neither does a group thread'
);

-- A stranger to the club cannot read the board.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$ select * from public.fetch_club_posts(
       '11111111-0000-0000-0000-000000000001') $$,
  '42501',
  'you cannot read this conversation',
  'a stranger is refused by can_read_thread, not by an empty list'
);

select * from finish();
rollback;
