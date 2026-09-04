begin;
set local search_path to extensions, public;

select plan(7);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Lakeside', 'lakeside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active');

insert into public.message_threads (id, club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-000000000002',
   'c2c2c2c2-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.messages (id, thread_id, author_id, body) values
  ('aa000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Riverside message'),
  ('bb000000-0000-0000-0000-00000000000b',
   '22222222-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Lakeside message');

select has_table('public', 'message_attachments', 'message_attachments exists');
select has_column('public', 'message_attachments', 'sort_order', 'has sort_order');
select col_type_is('public', 'message_attachments', 'width', 'integer', 'width is an integer');

insert into public.message_attachments
  (message_id, thread_id, storage_path, width, height, sort_order)
values
  ('aa000000-0000-0000-0000-00000000000a',
   '11111111-0000-0000-0000-000000000001',
   '11111111-0000-0000-0000-000000000001/img1.jpg', 800, 600, 0);

select ok(true, 'a same-thread attachment inserts cleanly');

-- The disclosure guard: an attachment cannot name a message in another
-- thread, the same shape as messages.reply_to_id and root_id.
select throws_ok(
  $$ insert into public.message_attachments
       (message_id, thread_id, storage_path, width, height, sort_order)
     values ('aa000000-0000-0000-0000-00000000000a',
             '22222222-0000-0000-0000-000000000002',
             '22222222-0000-0000-0000-000000000002/img2.jpg', 800, 600, 1) $$,
  '23503',
  null,
  'an attachment naming a message in another thread is unstateable'
);

-- A fifth sort_order is refused at the column check.
select throws_ok(
  $$ insert into public.message_attachments
       (message_id, thread_id, storage_path, width, height, sort_order)
     values ('bb000000-0000-0000-0000-00000000000b',
             '22222222-0000-0000-0000-000000000002',
             '22222222-0000-0000-0000-000000000002/img3.jpg', 800, 600, 4) $$,
  '23514',
  null,
  'sort_order is bounded to 0-3'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

-- Bob is not a member of Riverside's club (Lakeside only, via the seed
-- above -- actually neither; check_read below proves the deny).
select is(
  (select count(*)::int from public.message_attachments
    where thread_id = '11111111-0000-0000-0000-000000000001'),
  0,
  'a non-member of the thread reads no attachments'
);

select * from finish();
rollback;
