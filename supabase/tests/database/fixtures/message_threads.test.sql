begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(10);

select has_table('public', 'message_threads', 'message_threads table exists');
select has_table('public', 'thread_members', 'thread_members table exists');
select has_table('public', 'messages', 'messages table exists');
select has_table('public', 'thread_reads', 'thread_reads table exists');

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

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

-- One club thread per club, enforced by a PARTIAL unique index. A plain
-- `unique (club_id, event_id)` would NOT do this: NULLs are distinct in a
-- unique index, so it would permit a club unlimited club threads.
insert into public.message_threads (club_id) values
  ('c1c1c1c1-0000-0000-0000-000000000001');

select throws_ok(
  $$insert into public.message_threads (club_id)
    values ('c1c1c1c1-0000-0000-0000-000000000001')$$,
  '23505',
  null,
  'a club cannot have two club threads'
);

/*
 * The composite foreign key: a thread cannot point at an event in a
 * different club. Same guard bookings and broadcasts already carry.
 *
 * This runs BEFORE the event is given its own (successful) game thread
 * below: once that insert claims the event, message_threads_one_per_event
 * would reject any second row naming the same event_id with 23505 before
 * the composite foreign key is ever reached, which would mask the very
 * violation this assertion exists to prove.
 */
select throws_ok(
  $$insert into public.message_threads (club_id, event_id)
    values ('c2c2c2c2-0000-0000-0000-000000000002',
            'e1e1e1e1-0000-0000-0000-000000000001')$$,
  '23503',
  null,
  'a game thread cannot claim a club its event does not belong to'
);

-- One game thread per event.
insert into public.message_threads (club_id, event_id) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001');

select throws_ok(
  $$insert into public.message_threads (club_id, event_id)
    values ('c1c1c1c1-0000-0000-0000-000000000001',
            'e1e1e1e1-0000-0000-0000-000000000001')$$,
  '23505',
  null,
  'an event cannot have two game threads'
);

-- Group threads are deliberately unconstrained: two groups with the same
-- members are two groups.
insert into public.message_threads (title, created_by) values
  ('Tuesday four', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.message_threads (title, created_by) values
  ('Tuesday four', 'aaaaaaaa-0000-0000-0000-000000000001');
select pass('two group threads with the same title are allowed');

-- A game thread always knows its club.
select throws_ok(
  $$insert into public.message_threads (event_id)
    values ('e1e1e1e1-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'an event_id without a club_id is refused'
);

/*
 * Quoting across threads is a disclosure bug, not a mistake: it would render
 * one club's words inside another club's thread, where nothing downstream
 * asks whether the reader may see them. The composite foreign key is what
 * makes it unstateable, and this is the assertion that proves it.
 */
insert into public.message_threads (id, club_id) values
  ('99999999-0000-0000-0000-000000000009',
   'c2c2c2c2-0000-0000-0000-000000000002');
insert into public.messages (id, thread_id, author_id, body) values
  ('aa000000-0000-0000-0000-00000000000a',
   (select id from public.message_threads
     where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
       and event_id is null),
   'aaaaaaaa-0000-0000-0000-000000000001', 'Riverside only');

select throws_ok(
  $$insert into public.messages (thread_id, author_id, body, reply_to_id)
    values ('99999999-0000-0000-0000-000000000009',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'quoting the other club',
            'aa000000-0000-0000-0000-00000000000a')$$,
  '23503',
  null,
  'a reply cannot quote a message from another thread'
);

select * from finish();
rollback;
