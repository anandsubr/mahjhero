begin;
set local search_path to extensions, public;

select plan(14);

-- Alice and Carol share NO club -- that is the whole point. Alice hosts
-- Riverside, Carol hosts a second, unrelated club, and the only thing that
-- puts them in the same conversation is a group thread thread_members
-- carries directly. This is the cross-club case the friends feature exists
-- to enable, and the case club_roster (20260822180000) cannot serve at
-- all, because a group has no club_id to hand it.
--
-- Dave is a stranger to both clubs and to the group -- he proves the
-- refusal side.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dave@example.com');

update public.profiles set display_name = 'Alice Ng'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Carol Chen'
 where id = 'cccccccc-0000-0000-0000-000000000003';
update public.profiles set display_name = 'Dave Osei'
 where id = 'dddddddd-0000-0000-0000-000000000004';

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Lakeside', 'lakeside',
   'private', 'America/New_York', 'cccccccc-0000-0000-0000-000000000003');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003', 'host', 'active');

-- The club thread. Its roster is derived from club_members, never
-- materialised in thread_members, so thread_roster must answer empty for
-- it -- that emptiness is itself an assertion below, not an oversight.
insert into public.message_threads (id, club_id) values
  ('88888888-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001');

-- The group thread. No club_id, and its two members are seeded straight
-- into thread_members -- this fixture is testing the read RPCs, not
-- create_group_thread/can_reach, so there is no reason to route through
-- the mutation RPC to get here.
insert into public.message_threads (id, title, created_by) values
  ('77777777-0000-0000-0000-000000000001', 'Cross-club Group',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.thread_members (thread_id, profile_id) values
  ('77777777-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('77777777-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003');

-- Two messages, explicit created_at: the whole fixture runs inside one
-- transaction, so an unset default would tie both to the same
-- transaction-start now() and make "which one is first" undecidable --
-- the same collision thread_lists.test.sql documents for joined_at.
insert into public.messages
  (id, thread_id, author_id, body, created_at) values
  ('e5e5e5e5-0000-0000-0000-000000000001',
   '77777777-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'Anyone free Tuesday?', now() - interval '2 minutes');

insert into public.messages
  (id, thread_id, author_id, body, reply_to_id, created_at) values
  ('e5e5e5e5-0000-0000-0000-000000000002',
   '77777777-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'Yes, I am in.', 'e5e5e5e5-0000-0000-0000-000000000001',
   now() - interval '1 minute');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- thread_roster: the group case club_roster cannot serve.
-- ---------------------------------------------------------------------

select is(
  (select count(*)::int from public.thread_roster(
    '77777777-0000-0000-0000-000000000001')),
  2,
  'thread_roster lists both members of the group thread'
);

-- The finding this task exists to fix: Alice reads Carol's name even
-- though they share no club, because thread_roster is security definer and
-- re-asks membership itself rather than going through profiles' RLS.
select is(
  (select display_name from public.thread_roster(
    '77777777-0000-0000-0000-000000000001')
   where profile_id = 'cccccccc-0000-0000-0000-000000000003'),
  'Carol Chen',
  'a member reads a CROSS-CLUB co-member''s name through thread_roster'
);
select is(
  (select display_name from public.thread_roster(
    '77777777-0000-0000-0000-000000000001')
   where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Alice Ng',
  'thread_roster also names the caller themselves'
);

-- Club and game threads derive membership from club_members/bookings and
-- never populate thread_members, so thread_roster has nothing to return --
-- proving it does not silently invent a roster for a thread kind it was
-- not built to serve.
select is(
  (select count(*)::int from public.thread_roster(
    '88888888-0000-0000-0000-000000000001')),
  0,
  'thread_roster is empty for a club thread -- membership there is derived, not materialised'
);

-- ---------------------------------------------------------------------
-- fetch_thread_messages: sender names and the quoted parent, in one call.
-- ---------------------------------------------------------------------

select is(
  (select count(*)::int from public.fetch_thread_messages(
    '77777777-0000-0000-0000-000000000001')),
  2,
  'fetch_thread_messages returns both messages in the group thread'
);

select is(
  (select array_agg(id order by created_at) from public.fetch_thread_messages(
    '77777777-0000-0000-0000-000000000001')),
  array['e5e5e5e5-0000-0000-0000-000000000001'::uuid,
        'e5e5e5e5-0000-0000-0000-000000000002'::uuid],
  'oldest first'
);

select is(
  (select author_name from public.fetch_thread_messages(
    '77777777-0000-0000-0000-000000000001')
   where reply_to_id is null),
  'Alice Ng',
  'the first message names its own author'
);
select is(
  (select reply_to_id from public.fetch_thread_messages(
    '77777777-0000-0000-0000-000000000001')
   where reply_to_id is null),
  null,
  'and quotes nothing'
);

-- The same finding, at the message level: Carol's reply, read by Alice,
-- names Carol -- the sender-name half of the gap this task closes.
select is(
  (select author_name from public.fetch_thread_messages(
    '77777777-0000-0000-0000-000000000001')
   where reply_to_id is not null),
  'Carol Chen',
  'a member reads a CROSS-CLUB co-member''s name on their message'
);
select is(
  (select reply_to_id from public.fetch_thread_messages(
    '77777777-0000-0000-0000-000000000001')
   where reply_to_id is not null),
  'e5e5e5e5-0000-0000-0000-000000000001'::uuid,
  'the reply points at the first message'
);
select is(
  (select reply_to_body from public.fetch_thread_messages(
    '77777777-0000-0000-0000-000000000001')
   where reply_to_id is not null),
  'Anyone free Tuesday?',
  'the quoted parent''s body is resolved in the same call -- no second round trip'
);
select is(
  (select reply_to_author from public.fetch_thread_messages(
    '77777777-0000-0000-0000-000000000001')
   where reply_to_id is not null),
  'Alice Ng',
  'and the quoted parent''s author is named too'
);

-- ---------------------------------------------------------------------
-- A non-member gets 42501, not an empty result -- an empty result would
-- let a thread id be probed.
-- ---------------------------------------------------------------------

set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select throws_ok(
  $$select * from public.fetch_thread_messages('77777777-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a stranger cannot fetch_thread_messages on a group they are not in'
);
select throws_ok(
  $$select * from public.thread_roster('77777777-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a stranger cannot thread_roster on a group they are not in'
);

select * from finish();
rollback;
