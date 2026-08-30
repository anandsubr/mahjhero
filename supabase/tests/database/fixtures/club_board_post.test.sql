begin;
set local search_path to extensions, public;

select plan(14);

-- Alice hosts Riverside. Bob is a plain member. Both are in the club thread.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active');

insert into public.message_threads (id, club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- A group thread, to prove p_root is refused outside a club board.
insert into public.message_threads (id, created_by) values
  ('33333333-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.thread_members (thread_id, profile_id) values
  ('33333333-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

-- A plain member may start a post.
select lives_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'Anyone free Thursday?') $$,
  'a plain member can start a post'
);

select is(
  (select root_id from public.messages where body = 'Anyone free Thursday?'),
  null,
  'a new post is a root'
);

-- A reply attaches to that root and bumps its counters.
select lives_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'I am',
       false, null,
       (select id from public.messages where body = 'Anyone free Thursday?')) $$,
  'a member can reply into a post'
);

select is(
  (select reply_count from public.messages where body = 'Anyone free Thursday?'),
  1,
  'the root counts its reply'
);

select isnt(
  (select last_reply_at from public.messages where body = 'Anyone free Thursday?'),
  null,
  'the root records when it was last replied to'
);

-- One level only.
select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'nested',
       false, null,
       (select id from public.messages where body = 'I am')) $$,
  '22023',
  'you can only reply to a post in this conversation',
  'a reply cannot be replied to'
);

-- p_root is meaningless outside a club board.
select throws_ok(
  $$ select public.post_message('33333333-0000-0000-0000-000000000003',
       'grouped',
       false, null,
       (select id from public.messages where body = 'Anyone free Thursday?')) $$,
  '22023',
  'only a club has posts to reply to',
  'a group thread has no posts'
);

-- A plain member cannot announce.
select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'Hear ye', true) $$,
  '42501',
  null,
  'a plain member cannot announce'
);

-- An announcement must be a new post, not a reply.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'Hear ye', true, null,
       (select id from public.messages where body = 'Anyone free Thursday?')) $$,
  '22023',
  'only a new post can be an announcement',
  'an announcement is always a root'
);

-- A second post on the same board, so a cross-post quote is stateable to
-- test against.
select lives_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'Second post') $$,
  'Alice can start a second post'
);

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

-- A quote is scoped to its own post, not just its thread: replying into
-- post A while quoting a message that lives under post B is refused even
-- though both messages are in the same thread.
select throws_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'crossing posts',
       false,
       (select id from public.messages where body = 'Second post'),
       (select id from public.messages where body = 'Anyone free Thursday?')) $$,
  '22023',
  'you can only quote a message from the same post',
  'a reply cannot quote a message from a different post'
);

-- Quoting a message that already lives under the same post — here, a
-- sibling reply rather than the root itself — is fine.
select lives_ok(
  $$ select public.post_message('11111111-0000-0000-0000-000000000001',
       'agreed',
       false,
       (select id from public.messages where body = 'I am'),
       (select id from public.messages where body = 'Anyone free Thursday?')) $$,
  'a reply can quote a message under the same post'
);

-- Outside a board, a quote is not scoped to any post — the flat thread
-- path used by game and group conversations is untouched.
select lives_ok(
  $$ select public.post_message('33333333-0000-0000-0000-000000000003',
       'first in the group thread') $$,
  'a member can post in a flat group thread'
);

select lives_ok(
  $$ select public.post_message('33333333-0000-0000-0000-000000000003',
       'quoting in a flat thread',
       false,
       (select id from public.messages where body = 'first in the group thread')) $$,
  'a quote is legal anywhere in a flat thread'
);

select * from finish();
rollback;
