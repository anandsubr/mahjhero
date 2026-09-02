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
   'aaaaaaaa-0000-0000-0000-000000000001', 'Riverside root'),
  ('bb000000-0000-0000-0000-00000000000b',
   '22222222-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Lakeside root');

select has_column('public', 'messages', 'root_id', 'messages has root_id');
select col_type_is('public', 'messages', 'reply_count', 'integer',
  'reply_count is an integer');
select col_has_default('public', 'messages', 'reply_count',
  'reply_count defaults so existing rows read 0');
select has_column('public', 'messages', 'last_reply_at', 'messages has last_reply_at');

-- The disclosure guard: a reply cannot hang off a root in another thread.
select throws_ok(
  $$ insert into public.messages (thread_id, author_id, body, root_id)
     values ('11111111-0000-0000-0000-000000000001',
             'aaaaaaaa-0000-0000-0000-000000000001', 'cross-club reply',
             'bb000000-0000-0000-0000-00000000000b') $$,
  '23503',
  null,
  'a root in another thread is unstateable, not merely refused'
);

-- Degenerate self-reference.
select throws_ok(
  $$ update public.messages
        set root_id = id
      where id = 'aa000000-0000-0000-0000-00000000000a' $$,
  '23514',
  null,
  'a message cannot be its own root'
);

select has_table('public', 'post_reads', 'post_reads exists');

select * from finish();
rollback;
