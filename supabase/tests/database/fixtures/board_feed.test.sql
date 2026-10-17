begin;
set local search_path to extensions, public;

select plan(37);

-- Alice hosts Riverside. Bob and Carol are plain members. Dave was a member
-- and was removed (his old post stays on the board). Erin is a stranger.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dave@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com');

update public.profiles set display_name = 'Alice Ng'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Bob Ruiz'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set display_name = 'Carol Ito'
 where id = 'cccccccc-0000-0000-0000-000000000003';

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status, joined_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active',
   now() - interval '30 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active',
   now() - interval '30 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member', 'active',
   now() - interval '30 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004', 'member', 'removed',
   now() - interval '30 days');

insert into public.message_threads (id, club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- A group thread with one message, to prove a heart is refused outside a
-- club board even when the caller can read the thread.
insert into public.message_threads (id, title, created_by) values
  ('33333333-0000-0000-0000-000000000003', 'Tuesday four',
   'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.thread_members (thread_id, profile_id) values
  ('33333333-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002');
insert into public.messages (id, thread_id, author_id, body, created_at) values
  ('99000000-0000-0000-0000-000000000099',
   '33333333-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002', 'group chatter',
   now() - interval '1 day');

/*
 * Roots, timestamps seeded EXPLICITLY (now() is transaction-constant):
 *
 *   p1  Alice (host)    created -5d, 3 replies, last reply -1h
 *   p2  Bob             created -1d, no replies
 *   p3/p4/p5  Carol     all created -10d exactly, no replies (the tie)
 *   p6  Dave (removed)  created -20d, no replies
 *
 * 'recent' order:   p2, p1, p5, p4, p3, p6   (ties broken by id desc)
 * 'activity' order: p1, p2, p5, p4, p3, p6
 */
insert into public.messages (id, thread_id, author_id, body, created_at,
                             reply_count, last_reply_at) values
  ('a1000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Old post by Alice',
   now() - interval '5 days', 3, now() - interval '1 hour'),
  ('a2000000-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'New post by Bob',
   now() - interval '1 day', 0, null),
  ('a3000000-0000-0000-0000-000000000003',
   '11111111-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'Tie three',
   now() - interval '10 days', 0, null),
  ('a4000000-0000-0000-0000-000000000004',
   '11111111-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'Tie four',
   now() - interval '10 days', 0, null),
  ('a5000000-0000-0000-0000-000000000005',
   '11111111-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'Tie five',
   now() - interval '10 days', 0, null),
  ('a6000000-0000-0000-0000-000000000006',
   '11111111-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004', 'Post by a former member',
   now() - interval '20 days', 0, null);

-- Three replies on p1, inserted out of time order so the peek can only be
-- right if it truly orders by created_at.
insert into public.messages (id, thread_id, author_id, body, root_id, created_at) values
  ('f3000000-0000-0000-0000-000000000003',
   '11111111-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'third reply',
   'a1000000-0000-0000-0000-000000000001', now() - interval '1 hour'),
  ('f1000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'first reply',
   'a1000000-0000-0000-0000-000000000001', now() - interval '3 days'),
  ('f2000000-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'second reply',
   'a1000000-0000-0000-0000-000000000001', now() - interval '2 days');

-- One attachment on p1, none anywhere else.
insert into public.message_attachments
  (message_id, thread_id, storage_path, width, height, sort_order) values
  ('a1000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001/a.jpg', 800, 600, 0);

-- ---------------------------------------------------------------------
-- The table is not a client surface.
-- ---------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'public.post_hearts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.post_hearts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.post_hearts', 'DELETE'),
  'authenticated has no direct privileges on post_hearts'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.post_hearts'::regclass),
  'post_hearts has RLS on'
);

select ok(
  not has_function_privilege('anon', 'public.toggle_post_heart(uuid)', 'EXECUTE'),
  'anon cannot toggle a heart'
);

select ok(
  not has_function_privilege('anon',
    'public.fetch_club_feed(uuid, integer, timestamp with time zone, uuid, text)',
    'EXECUTE'),
  'anon cannot read the feed'
);

-- ---------------------------------------------------------------------
-- Hearts, as Bob.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  public.toggle_post_heart('a1000000-0000-0000-0000-000000000001'),
  true,
  'a member hearting a post gets true back'
);

select is(
  (select heart_count from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  1,
  'the post now counts one heart'
);

select is(
  (select hearted_by_me from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  true,
  'and the feed says Bob hearted it'
);

select is(
  public.toggle_post_heart('a1000000-0000-0000-0000-000000000001'),
  false,
  'toggling again un-hearts it'
);

select is(
  (select heart_count from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  0,
  'and the count goes back to zero, not below'
);

select is(
  (select hearted_by_me from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  false,
  'and the feed no longer says Bob hearted it'
);

select is(
  public.toggle_post_heart('a1000000-0000-0000-0000-000000000001'),
  true,
  'Bob hearts it again'
);

-- A reply is not a post.
select throws_ok(
  $$ select public.toggle_post_heart('f1000000-0000-0000-0000-000000000001') $$,
  '22023',
  'not_a_post',
  'a reply cannot be hearted'
);

-- A message in a group thread Bob can read is not a post either.
select throws_ok(
  $$ select public.toggle_post_heart('99000000-0000-0000-0000-000000000099') $$,
  '22023',
  'not_a_post',
  'a group message cannot be hearted'
);

select throws_ok(
  $$ select public.toggle_post_heart('00000000-0000-0000-0000-00000000dead') $$,
  '22023',
  'not_a_post',
  'an id that names no message is not a post'
);

-- Carol hearts the same post: two members, two hearts.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  public.toggle_post_heart('a1000000-0000-0000-0000-000000000001'),
  true,
  'a second member can heart the same post'
);

-- Alice sees the count but has not hearted.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select heart_count from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  2,
  'two members, two hearts'
);

select is(
  (select hearted_by_me from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  false,
  'hearted_by_me is the caller''s own heart, not anyone''s'
);

-- ---------------------------------------------------------------------
-- Feed shape, as Bob.
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')),
  6,
  'the feed lists roots only, never replies'
);

select is(
  (select author_role from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  'host'::public.club_role,
  'a host author carries the host role'
);

select is(
  (select author_role from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a2000000-0000-0000-0000-000000000002'),
  'member'::public.club_role,
  'a plain member author carries the member role'
);

select is(
  (select author_role from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a6000000-0000-0000-0000-000000000006'),
  null,
  'an author who has left the club has no role'
);

select is(
  (select attachments from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  (select jsonb_build_array(jsonb_build_object(
     'id', a.id,
     'storage_path', '11111111-0000-0000-0000-000000000001/a.jpg',
     'width', 800, 'height', 600, 'sort_order', 0))
     from public.message_attachments a
    where a.message_id = 'a1000000-0000-0000-0000-000000000001'),
  'a post with a photo carries its attachment'
);

select is(
  (select attachments from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a2000000-0000-0000-0000-000000000002'),
  '[]'::jsonb,
  'a post without photos carries an empty array, not null'
);

select is(
  (select jsonb_path_query_array(recent_comments, '$[*].id')
     from public.fetch_club_feed('11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  '["f2000000-0000-0000-0000-000000000002",
    "f3000000-0000-0000-0000-000000000003"]'::jsonb,
  'recent_comments holds the two latest of three replies, oldest first'
);

select is(
  (select recent_comments -> 1
     from public.fetch_club_feed('11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001')
    - 'created_at',
  jsonb_build_object(
    'id', 'f3000000-0000-0000-0000-000000000003',
    'author_id', 'cccccccc-0000-0000-0000-000000000003',
    'author_name', 'Carol Ito',
    'body', 'third reply'),
  'each comment carries id, author, name and body'
);

select is(
  (select (recent_comments -> 1 ->> 'created_at')::timestamptz
     from public.fetch_club_feed('11111111-0000-0000-0000-000000000001')
    where id = 'a1000000-0000-0000-0000-000000000001'),
  now() - interval '1 hour',
  'and its created_at'
);

select is(
  (select recent_comments from public.fetch_club_feed(
     '11111111-0000-0000-0000-000000000001')
    where id = 'a2000000-0000-0000-0000-000000000002'),
  '[]'::jsonb,
  'a post without replies has an empty comment peek'
);

-- Unread / last_activity / counters agree with fetch_club_posts exactly.
select set_eq(
  $$ select id, author_id, author_name, body, subject, is_announcement,
            created_at, reply_count, last_reply_at, last_activity_at, unread
       from public.fetch_club_feed('11111111-0000-0000-0000-000000000001',
                                   100, null, null, 'activity') $$,
  $$ select * from public.fetch_club_posts('11111111-0000-0000-0000-000000000001',
                                           100) $$,
  'the feed''s shared columns match fetch_club_posts row for row'
);

-- ---------------------------------------------------------------------
-- Ordering.
-- ---------------------------------------------------------------------
select results_eq(
  $$ select id from public.fetch_club_feed(
       '11111111-0000-0000-0000-000000000001') $$,
  $$ values ('a2000000-0000-0000-0000-000000000002'::uuid),
            ('a1000000-0000-0000-0000-000000000001'::uuid),
            ('a5000000-0000-0000-0000-000000000005'::uuid),
            ('a4000000-0000-0000-0000-000000000004'::uuid),
            ('a3000000-0000-0000-0000-000000000003'::uuid),
            ('a6000000-0000-0000-0000-000000000006'::uuid) $$,
  'the default order is newest post first, ties by id'
);

select results_eq(
  $$ select id from public.fetch_club_feed(
       '11111111-0000-0000-0000-000000000001', 30, null, null, 'activity') $$,
  $$ values ('a1000000-0000-0000-0000-000000000001'::uuid),
            ('a2000000-0000-0000-0000-000000000002'::uuid),
            ('a5000000-0000-0000-0000-000000000005'::uuid),
            ('a4000000-0000-0000-0000-000000000004'::uuid),
            ('a3000000-0000-0000-0000-000000000003'::uuid),
            ('a6000000-0000-0000-0000-000000000006'::uuid) $$,
  '''activity'' puts the older post with a newer reply first'
);

select throws_ok(
  $$ select * from public.fetch_club_feed(
       '11111111-0000-0000-0000-000000000001', 30, null, null, 'popular') $$,
  '22023',
  'unknown feed order',
  'an unknown order is refused, not silently treated as recent'
);

-- ---------------------------------------------------------------------
-- Keyset paging through the three-way created_at tie.
-- ---------------------------------------------------------------------
select results_eq(
  $$ select id from public.fetch_club_feed(
       '11111111-0000-0000-0000-000000000001', 2,
       now() - interval '5 days', 'a1000000-0000-0000-0000-000000000001') $$,
  $$ values ('a5000000-0000-0000-0000-000000000005'::uuid),
            ('a4000000-0000-0000-0000-000000000004'::uuid) $$,
  'a page after p1 starts inside the tie'
);

select results_eq(
  $$ select id from public.fetch_club_feed(
       '11111111-0000-0000-0000-000000000001', 2,
       now() - interval '10 days', 'a4000000-0000-0000-0000-000000000004') $$,
  $$ values ('a3000000-0000-0000-0000-000000000003'::uuid),
            ('a6000000-0000-0000-0000-000000000006'::uuid) $$,
  'the next page resumes at the third tied post — no duplicate, no gap'
);

select results_eq(
  $$ select id from public.fetch_club_feed(
       '11111111-0000-0000-0000-000000000001', 1,
       now() - interval '1 hour', 'a1000000-0000-0000-0000-000000000001',
       'activity') $$,
  $$ values ('a2000000-0000-0000-0000-000000000002'::uuid) $$,
  '''activity'' pages by last_activity_at'
);

-- ---------------------------------------------------------------------
-- Access.
-- ---------------------------------------------------------------------
select throws_ok(
  $$ select * from public.fetch_club_feed(
       '33333333-0000-0000-0000-000000000003') $$,
  '22023',
  'only a club has posts to list',
  'a group thread has no feed'
);

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$ select public.toggle_post_heart('a1000000-0000-0000-0000-000000000001') $$,
  '42501',
  'you cannot read this conversation',
  'a stranger cannot heart a post'
);

select throws_ok(
  $$ select * from public.fetch_club_feed(
       '11111111-0000-0000-0000-000000000001') $$,
  '42501',
  'you cannot read this conversation',
  'a stranger cannot read the feed'
);

select * from finish();
rollback;
