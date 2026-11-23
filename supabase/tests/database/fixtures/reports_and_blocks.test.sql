begin;
set local search_path to extensions, public;

select plan(87);

/*
 * Reports and blocks (20261122110000).
 *
 * Riverside: Alice, Bob and Cara. Dev is in no club with any of them. Zed is
 * the app admin (profiles.is_admin) and a member of nothing.
 *
 * Alice blocks Bob. On the board Bob has a post (with a reply by Cara) and
 * a reply on Alice's post; there is a three-person group (Alice, Bob, Cara)
 * whose latest message is Bob's and in which Cara quotes Bob; a DM between
 * Alice and Bob; and a photo each from Bob and Cara.
 */
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'cara@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dev@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'zed@example.com');

update public.profiles set display_name = 'Alice'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Bob'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set display_name = 'Cara'
 where id = 'cccccccc-0000-0000-0000-000000000003';
update public.profiles set display_name = 'Dev'
 where id = 'dddddddd-0000-0000-0000-000000000004';
update public.profiles set display_name = 'Zed', is_admin = true
 where id = 'eeeeeeee-0000-0000-0000-000000000005';

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status, joined_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active', now() - interval '30 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active', now() - interval '30 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member', 'active', now() - interval '30 days');

-- Threads: the club board, a group of three, a DM.
insert into public.message_threads (id, club_id, created_by, last_message_at) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 hour');
insert into public.message_threads (id, title, created_by, last_message_at) values
  ('22222222-0000-0000-0000-000000000002', null,
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 hour'),
  ('33333333-0000-0000-0000-000000000003', null,
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '2 hours');
insert into public.thread_members (thread_id, profile_id, joined_at) values
  ('22222222-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('22222222-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', now() - interval '10 days'),
  ('22222222-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', now() - interval '10 days'),
  ('33333333-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '10 days'),
  ('33333333-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', now() - interval '10 days');

/*
 * Board:
 *   P1  Bob's post   (-3d), reply R1 by Cara (-2d, with an attachment)
 *   P2  Alice's post (-4d), reply R2 by Bob (-1d), reply R3 by Cara (-2d)
 */
insert into public.messages (id, thread_id, author_id, body, created_at,
                             reply_count, last_reply_at) values
  ('a1000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Bob post',
   now() - interval '3 days', 1, now() - interval '2 days'),
  ('a2000000-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Alice post',
   now() - interval '4 days', 2, now() - interval '1 day');
insert into public.messages (id, thread_id, author_id, body, root_id, created_at) values
  ('f1000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'Cara on Bob',
   'a1000000-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('f2000000-0000-0000-0000-000000000002',
   '11111111-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Bob on Alice',
   'a2000000-0000-0000-0000-000000000002', now() - interval '1 day'),
  ('f3000000-0000-0000-0000-000000000003',
   '11111111-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'Cara on Alice',
   'a2000000-0000-0000-0000-000000000002', now() - interval '2 days');
insert into public.message_attachments
  (message_id, thread_id, storage_path, width, height, sort_order) values
  ('f1000000-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001/r1.jpg', 800, 600, 0);

-- Group of three: Bob, then Cara quoting Bob, then Bob again (latest).
insert into public.messages (id, thread_id, author_id, body, created_at) values
  ('90000000-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Bob in group',
   now() - interval '3 hours');
insert into public.messages (id, thread_id, author_id, body, created_at, reply_to_id) values
  ('90000000-0000-0000-0000-000000000002',
   '22222222-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003', 'Cara quoting Bob',
   now() - interval '2 hours', '90000000-0000-0000-0000-000000000001');
insert into public.messages (id, thread_id, author_id, body, created_at) values
  ('90000000-0000-0000-0000-000000000003',
   '22222222-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Bob latest in group',
   now() - interval '1 hour'),
  ('90000000-0000-0000-0000-000000000004',
   '33333333-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Bob in DM',
   now() - interval '2 hours');

-- Bob's first group message carries an image.
insert into public.message_attachments
  (message_id, thread_id, storage_path, width, height, sort_order) values
  ('90000000-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000002',
   '22222222-0000-0000-0000-000000000002/bob.jpg', 800, 600, 0);

insert into public.club_media
  (id, club_id, kind, storage_path, file_name, mime_type, size_bytes,
   uploaded_by) values
  ('3ed1a000-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'photo',
   'c1c1c1c1-0000-0000-0000-000000000001/photos/bob.jpg', 'bob.jpg',
   'image/jpeg', 100, 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('3ed1a000-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'photo',
   'c1c1c1c1-0000-0000-0000-000000000001/photos/cara.jpg', 'cara.jpg',
   'image/jpeg', 100, 'cccccccc-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------
-- Privileges.
-- ---------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'public.user_blocks', 'SELECT')
  and not has_table_privilege('authenticated', 'public.user_blocks', 'INSERT')
  and not has_table_privilege('authenticated', 'public.content_reports', 'SELECT')
  and not has_table_privilege('authenticated', 'public.content_reports', 'INSERT'),
  'authenticated has no direct privileges on user_blocks or content_reports'
);
select ok(
  has_table_privilege('service_role', 'public.content_reports', 'SELECT'),
  'service_role can read content_reports (notify-report)'
);
select ok(
  not has_function_privilege('anon', 'public.report_content(text, uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.block_user(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.unblock_user(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.fetch_my_blocks()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.fetch_reports(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.resolve_report(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.is_blocked_by_me(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.is_admin()', 'EXECUTE'),
  'anon cannot execute any of the new functions'
);
select ok(
  not has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE'),
  'is_admin is internal'
);

-- ---------------------------------------------------------------------
-- Blocks: as Alice.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- Before the block, Alice sees Bob everywhere (so the filters below are
-- proven to be the block, not the fixture).
select is(
  (select count(*)::int from public.fetch_thread_messages('11111111-0000-0000-0000-000000000001')
    where author_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  2, 'before blocking, Alice sees Bob''s two board messages');
select ok(public.can_post_thread('33333333-0000-0000-0000-000000000003'),
  'before blocking, Alice can post in the DM');
select is(
  (select count(*)::int from public.fetch_post_messages('a1000000-0000-0000-0000-000000000001')),
  2, 'before blocking, Alice can open Bob''s post and its reply');
select is(
  (select count(*)::int from public.message_attachments
    where message_id = '90000000-0000-0000-0000-000000000001'),
  1, 'before blocking, Alice can read Bob''s attachment row');

select throws_ok(
  $$ select public.block_user('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '22023', 'you cannot block yourself', 'self-block is refused');
select throws_ok(
  $$ select public.block_user(null) $$,
  '22023', 'you cannot block yourself', 'a null block is refused');
select throws_ok(
  $$ select public.block_user('00000000-0000-0000-0000-00000000dead') $$,
  '22023', 'no such person', 'blocking an unknown id is refused');

select lives_ok(
  $$ select public.block_user('bbbbbbbb-0000-0000-0000-000000000002') $$,
  'Alice blocks Bob');
select lives_ok(
  $$ select public.block_user('bbbbbbbb-0000-0000-0000-000000000002') $$,
  'blocking again is a no-op');

select results_eq(
  $$ select blocked_id, display_name from public.fetch_my_blocks() $$,
  $$ values ('bbbbbbbb-0000-0000-0000-000000000002'::uuid, 'Bob'::text) $$,
  'fetch_my_blocks lists Bob by name, once');

select ok(public.is_blocked_by_me('bbbbbbbb-0000-0000-0000-000000000002'),
  'is_blocked_by_me answers for the caller');

-- Thread messages: club chat and the group.
select is(
  (select count(*)::int from public.fetch_thread_messages('11111111-0000-0000-0000-000000000001')
    where author_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0, 'club chat: Bob''s messages are hidden from Alice');
select is(
  (select count(*)::int from public.fetch_thread_messages('11111111-0000-0000-0000-000000000001')),
  3, 'club chat: everyone else''s still show');
select is(
  (select count(*)::int from public.fetch_thread_messages('22222222-0000-0000-0000-000000000002')
    where author_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0, 'group: Bob''s messages are hidden from Alice');
select is(
  (select reply_to_body from public.fetch_thread_messages('22222222-0000-0000-0000-000000000002')
    where id = '90000000-0000-0000-0000-000000000002'),
  null, 'group: Cara''s quote of Bob shows no text');
select is(
  (select count(*)::int from public.fetch_thread_messages('33333333-0000-0000-0000-000000000003')),
  0, 'DM: Bob''s message is hidden from Alice');

-- Board feed, posts, post replies.
select is(
  (select array_agg(id order by id) from public.fetch_club_feed('11111111-0000-0000-0000-000000000001')),
  array['a2000000-0000-0000-0000-000000000002'::uuid],
  'board feed: Bob''s post is hidden');
select is(
  (select jsonb_path_query_array(recent_comments, '$[*].body')
     from public.fetch_club_feed('11111111-0000-0000-0000-000000000001')
    where id = 'a2000000-0000-0000-0000-000000000002'),
  '["Cara on Alice"]'::jsonb,
  'board feed: Bob''s reply is not in the comment peek');
select is(
  (select array_agg(id order by id) from public.fetch_club_posts('11111111-0000-0000-0000-000000000001')),
  array['a2000000-0000-0000-0000-000000000002'::uuid],
  'fetch_club_posts: Bob''s post is hidden');
select is(
  (select array_agg(id order by id) from public.fetch_post_messages('a2000000-0000-0000-0000-000000000002')),
  array['a2000000-0000-0000-0000-000000000002'::uuid,
        'f3000000-0000-0000-0000-000000000003'::uuid],
  'post replies: Bob''s reply is hidden');
select throws_ok(
  $$ select * from public.fetch_post_messages('a1000000-0000-0000-0000-000000000001') $$,
  '22023', 'that post is no longer here',
  'Bob''s post itself reads as gone, not as its replies with no post');

-- Media.
select is(
  (select array_agg(id order by id) from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo')),
  array['3ed1a000-0000-0000-0000-000000000002'::uuid],
  'media: Bob''s photo is hidden');

-- My-threads preview.
select is(
  (select last_body from public.fetch_my_threads()
    where thread_id = '22222222-0000-0000-0000-000000000002'),
  'Cara quoting Bob',
  'my-threads: the group preview skips Bob''s latest message');
select is(
  (select last_body from public.fetch_my_threads()
    where thread_id = '33333333-0000-0000-0000-000000000003'),
  null,
  'my-threads: the DM preview shows nothing of Bob''s');

-- Direct table reads (RLS), the path realtime uses too.
select is(
  (select count(*)::int from public.messages
    where author_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0, 'RLS: a direct select on messages hides Bob''s rows from Alice');
select is(
  (select count(*)::int from public.messages), 4,
  'RLS: and still returns everyone else''s');
select is(
  (select count(*)::int from public.club_media
    where uploaded_by = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0, 'RLS: a direct select on club_media hides Bob''s rows from Alice');
select is(
  (select count(*)::int from public.message_attachments
    where message_id = '90000000-0000-0000-0000-000000000001'),
  0, 'RLS: a direct select on message_attachments hides Bob''s attachment from Alice');

-- Contact.
select ok(not public.can_post_thread('33333333-0000-0000-0000-000000000003'),
  'Alice cannot post in her DM with Bob');
select ok(public.can_post_thread('22222222-0000-0000-0000-000000000002'),
  'Alice can still post in the three-person group');
select throws_ok(
  $$ select public.post_message('33333333-0000-0000-0000-000000000003', 'hi') $$,
  '42501', 'you cannot post in this conversation',
  'post_message into the DM is refused');
select throws_ok(
  $$ select public.create_group_thread(null, array['bbbbbbbb-0000-0000-0000-000000000002'::uuid]) $$,
  '42501', 'you can only message people from your clubs or your friends',
  'Alice cannot open a DM to Bob (not even the existing one)');
select lives_ok(
  $$ select public.create_group_thread(null, array['cccccccc-0000-0000-0000-000000000003'::uuid]) $$,
  'Alice can still DM Cara');

-- ---------------------------------------------------------------------
-- As Bob, the blocked person: visibility is one-way, contact symmetric.
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.fetch_thread_messages('11111111-0000-0000-0000-000000000001')
    where author_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1, 'Bob still sees Alice''s post (visibility is one-way)');
select is(
  (select count(*)::int from public.fetch_my_blocks()), 0,
  'Bob''s own block list is empty: nothing tells him');
select ok(not public.can_post_thread('33333333-0000-0000-0000-000000000003'),
  'Bob cannot post in the DM either');
select throws_ok(
  $$ select public.create_group_thread(null, array['aaaaaaaa-0000-0000-0000-000000000001'::uuid]) $$,
  '42501', 'you can only message people from your clubs or your friends',
  'Bob cannot open a DM to Alice');
select throws_ok(
  $$ select public.add_to_group_thread('22222222-0000-0000-0000-000000000002',
       array['aaaaaaaa-0000-0000-0000-000000000001'::uuid]) $$,
  '42501', 'you can only message people from your clubs or your friends',
  'nor add Alice to a group');

reset role;
select ok(
  not public.can_reach('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')
  and not public.can_reach('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001'),
  'can_reach is false across the block in both directions');
select ok(
  public.can_reach('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003'),
  'and unaffected for anyone else');

-- ---------------------------------------------------------------------
-- Unblock.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select public.unblock_user('bbbbbbbb-0000-0000-0000-000000000002') $$,
  'Alice unblocks Bob');
select is((select count(*)::int from public.fetch_my_blocks()), 0,
  'unblock removes the block');
select lives_ok(
  $$ select public.unblock_user('bbbbbbbb-0000-0000-0000-000000000002') $$,
  'unblocking again is a no-op');
select ok(public.can_post_thread('33333333-0000-0000-0000-000000000003'),
  'after unblocking, Alice can post in the DM again');
select is(
  (select count(*)::int from public.fetch_club_feed('11111111-0000-0000-0000-000000000001')),
  2, 'and Bob''s post is back in the feed');
select is(
  (select count(*)::int from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo')
    where uploaded_by = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1, 'and Bob''s photo is back in the media');
select is(
  (select last_body from public.fetch_my_threads()
    where thread_id = '22222222-0000-0000-0000-000000000002'),
  'Bob latest in group',
  'and the group preview shows Bob''s latest message again');

-- ---------------------------------------------------------------------
-- Reports: as Cara.
-- ---------------------------------------------------------------------
reset role;
create temp table ids (label text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';

insert into ids values ('post',
  public.report_content('message', 'a1000000-0000-0000-0000-000000000001', 'spam', '  buy now  '));
select isnt((select id from ids where label = 'post'), null,
  'reporting a readable board post returns an id');
insert into ids values ('reply',
  public.report_content('message', 'f2000000-0000-0000-0000-000000000002', 'harassment'));
insert into ids values ('media',
  public.report_content('club_media', '3ed1a000-0000-0000-0000-000000000001', 'inappropriate'));
select isnt((select id from ids where label = 'media'), null,
  'reporting readable media returns an id');
insert into ids values ('profile',
  public.report_content('profile', 'bbbbbbbb-0000-0000-0000-000000000002', 'other', repeat('x', 500)));
select isnt((select id from ids where label = 'profile'), null,
  'reporting a co-member''s profile returns an id (500-char details allowed)');
insert into ids values ('profile2',
  public.report_content('profile', 'bbbbbbbb-0000-0000-0000-000000000002', 'spam'));

select throws_ok(
  $$ select public.report_content('message', 'a1000000-0000-0000-0000-000000000001', 'rude') $$,
  '22023', 'unknown report reason', 'an invalid reason is refused');
select throws_ok(
  $$ select public.report_content('message', 'a1000000-0000-0000-0000-000000000001', 'spam', repeat('x', 501)) $$,
  '22023', 'report details are too long', 'details over 500 characters are refused');
select throws_ok(
  $$ select public.report_content('thread', 'a1000000-0000-0000-0000-000000000001', 'spam') $$,
  '22023', 'unknown report kind', 'an invalid kind is refused');
select throws_ok(
  $$ select public.report_content('profile', 'cccccccc-0000-0000-0000-000000000003', 'spam') $$,
  '22023', 'you cannot report yourself', 'reporting yourself is refused');
select throws_ok(
  $$ select public.report_content('message', 'f1000000-0000-0000-0000-000000000001', 'spam') $$,
  '22023', 'you cannot report yourself', 'reporting your own message is refused');

select throws_ok($$ select * from public.fetch_reports() $$,
  '42501', 'not allowed', 'a non-admin cannot fetch reports');
select throws_ok(
  $$ select * from public.resolve_report((select id from ids where label = 'post'), 'dismiss') $$,
  '42501', 'not allowed', 'a non-admin cannot resolve a report');

-- As Dev, who shares nothing with any of them.
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ select public.report_content('message', 'a1000000-0000-0000-0000-000000000001', 'spam') $$,
  '42501', 'you cannot report this', 'an unreadable message cannot be reported');
select throws_ok(
  $$ select public.report_content('club_media', '3ed1a000-0000-0000-0000-000000000001', 'spam') $$,
  '42501', 'you cannot report this', 'media outside your clubs cannot be reported');
select throws_ok(
  $$ select public.report_content('profile', 'bbbbbbbb-0000-0000-0000-000000000002', 'spam') $$,
  '42501', 'you cannot report this', 'a stranger''s profile cannot be reported');
select throws_ok(
  $$ select public.report_content('message', '00000000-0000-0000-0000-00000000dead', 'spam') $$,
  '42501', 'you cannot report this', 'an unknown id gets the same refusal');

-- ---------------------------------------------------------------------
-- Admin: as Zed.
-- ---------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select is((select count(*)::int from public.fetch_reports()), 5,
  'the admin sees all five open reports');
select results_eq(
  $$ select kind, reason, details, reporter_name, reported_name, message_body,
            message_thread_id, club_name
       from public.fetch_reports('open')
      where id = (select id from ids where label = 'post') $$,
  $$ values ('message'::text, 'spam'::text, 'buy now'::text, 'Cara'::text,
             'Bob'::text, 'Bob post'::text,
             '11111111-0000-0000-0000-000000000001'::uuid, 'Riverside'::text) $$,
  'a message report carries reporter, reported person, body, thread and club');
select results_eq(
  $$ select media_kind, media_path, media_name, reported_name
       from public.fetch_reports('open')
      where id = (select id from ids where label = 'media') $$,
  $$ values ('photo'::text,
             'c1c1c1c1-0000-0000-0000-000000000001/photos/bob.jpg'::text,
             'bob.jpg'::text, 'Bob'::text) $$,
  'a media report carries the path and name');
select throws_ok($$ select * from public.fetch_reports('closed') $$,
  '22023', 'unknown report status', 'an unknown status is refused');
select throws_ok(
  $$ select * from public.resolve_report((select id from ids where label = 'post'), 'ban') $$,
  '22023', 'unknown report action', 'an unknown action is refused');

-- Remove a board root: the post and its reply go, with the reply's image.
select results_eq(
  $$ select bucket, storage_path from public.resolve_report(
       (select id from ids where label = 'post'), 'remove') $$,
  $$ values ('message-images'::text,
             '11111111-0000-0000-0000-000000000001/r1.jpg'::text) $$,
  'removing a post returns its replies'' attachment paths');
select is(
  (select count(*)::int from public.messages
    where id in ('a1000000-0000-0000-0000-000000000001',
                 'f1000000-0000-0000-0000-000000000001')),
  0, 'the post and its reply are deleted');

reset role;
select results_eq(
  $$ select status, resolved_by, resolved_at is not null
       from public.content_reports where id = (select id from ids where label = 'post') $$,
  $$ values ('removed'::text, 'eeeeeeee-0000-0000-0000-000000000005'::uuid, true) $$,
  'the report is marked removed, by Zed, with a time');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

-- Remove a reply: the post's counters are rebuilt.
select is(
  (select count(*)::int from public.resolve_report(
     (select id from ids where label = 'reply'), 'remove')),
  0, 'removing a reply with no attachments returns no paths');
reset role;
select results_eq(
  $$ select reply_count, last_reply_at = now() - interval '2 days'
       from public.messages where id = 'a2000000-0000-0000-0000-000000000002' $$,
  $$ values (1, true) $$,
  'the post''s reply_count and last_reply_at no longer count the removed reply');
select ok(
  not exists (select 1 from public.messages where id = 'f2000000-0000-0000-0000-000000000002')
  and exists (select 1 from public.messages where id = 'a2000000-0000-0000-0000-000000000002'),
  'only the reply is deleted, not its post');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

-- Remove media.
select results_eq(
  $$ select bucket, storage_path from public.resolve_report(
       (select id from ids where label = 'media'), 'remove') $$,
  $$ values ('club-media'::text,
             'c1c1c1c1-0000-0000-0000-000000000001/photos/bob.jpg'::text) $$,
  'removing media returns its storage path');

-- Dismiss a profile report; a second one cannot be "removed".
select is(
  (select count(*)::int from public.resolve_report(
     (select id from ids where label = 'profile'), 'dismiss')),
  0, 'dismissing returns nothing');
select throws_ok(
  $$ select * from public.resolve_report((select id from ids where label = 'profile'), 'dismiss') $$,
  '22023', 'that report is already resolved', 'a resolved report cannot be resolved again');
select throws_ok(
  $$ select * from public.resolve_report((select id from ids where label = 'profile2'), 'remove') $$,
  '22023', 'a profile report can only be dismissed', 'a profile report has nothing to remove');
select throws_ok(
  $$ select * from public.resolve_report('00000000-0000-0000-0000-00000000dead', 'dismiss') $$,
  '22023', 'no such report', 'an unknown report is refused');

select is((select count(*)::int from public.fetch_reports('removed')), 3,
  'three reports are now removed');
select is((select count(*)::int from public.fetch_reports('dismissed')), 1,
  'one is dismissed');

reset role;
select ok(
  not exists (select 1 from public.club_media where id = '3ed1a000-0000-0000-0000-000000000001'),
  'the media row is deleted');
select results_eq(
  $$ select status, resolved_by from public.content_reports
      where id = (select id from ids where label = 'profile') $$,
  $$ values ('dismissed'::text, 'eeeeeeee-0000-0000-0000-000000000005'::uuid) $$,
  'dismiss sets the status and resolver');
select ok(
  exists (select 1 from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002')
  and (select count(*) from public.messages
        where author_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 3,
  'dismiss deletes nothing');
select is(
  (select count(*)::int from public.content_reports where status = 'open'), 1,
  'only the second profile report is still open');

select * from finish();
rollback;
