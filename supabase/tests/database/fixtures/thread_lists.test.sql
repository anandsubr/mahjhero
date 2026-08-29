begin;
set local search_path to extensions, public;

select plan(11);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

update public.profiles set display_name = 'Alice Ng'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Bob Reyes'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

-- joined_at is set explicitly, and DELIBERATELY earlier than now(): the
-- whole fixture runs inside one transaction, so an unset default would tie
-- every row (including every message posted below) to the same
-- transaction-start now() and make the unread floor's `created_at >
-- floor_at` comparison a tie instead of a real "before". This is the exact
-- collision waitlist_promotion.test.sql already documents for created_at.
insert into public.club_members (club_id, profile_id, role, status, joined_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active', now() - interval '1 hour'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active', now() - interval '1 hour');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('b1b1b1b1-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- One game in two days, one that finished two days ago.
insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           status, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday Night',
   'b1b1b1b1-0000-0000-0000-000000000001',
   now() + interval '2 days', now() + interval '2 days 3 hours',
   'published', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Last Thursday',
   'b1b1b1b1-0000-0000-0000-000000000001',
   now() - interval '2 days 3 hours', now() - interval '2 days',
   'published', 'aaaaaaaa-0000-0000-0000-000000000001');

-- bookings.group_id is not-null (20260825000000), so a confirmed seat
-- needs a booking_groups row per event; the brief's INSERT omitted it.
insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002'),
  ('9909aaaa-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.bookings (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  ('9909aaaa-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

-- A club thread with no messages is still listed, with a null id: the
-- artboard always shows "Everyone at <club>", and the client calls
-- open_thread_for_club on tap.
select is(
  (select count(*)::int from public.fetch_my_threads()),
  1,
  'an empty club thread is listed before anybody has posted'
);
select is(
  (select thread_id from public.fetch_my_threads()),
  null,
  'and it carries no thread id yet'
);
select is(
  (select title from public.fetch_my_threads()),
  'Everyone at Riverside',
  'and it is named after its club'
);

-- A game thread with no messages is NOT listed. This is the whole answer to
-- thread sprawl: a weekly club would otherwise grow fifty dead rows a year.
select public.open_thread_for_event('e1e1e1e1-0000-0000-0000-000000000001');
select is(
  (select count(*)::int from public.fetch_my_threads() where kind = 'game'),
  0,
  'an opened but unused game thread stays out of the list'
);

-- The backfill migration has already run against an empty broadcasts table.
-- Seed one and re-run its statement to prove both the mapping and that a
-- second run is a no-op.
--
-- Placed here, not up with the rest of the setup: backfill_broadcasts_into_
-- threads() is revoked from authenticated, so it has to run as the table
-- owner — but running it any earlier would itself create Riverside's club
-- thread row and stamp Tuesday Night's game thread with a last_message_at,
-- which is exactly the "nobody has posted yet" state the two assertions
-- above depend on. Their assertions, not this one, own that state, so this
-- runs after them instead. `reset role` / `set local role authenticated`
-- bracket it so bob's session picks back up unchanged.
reset role;

insert into public.broadcasts (id, club_id, event_id, author_id, subject, body,
                               recipient_count, created_at) values
  ('b1b1b1b1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'Door code changed', 'It is 4321 from now on.', 2,
   now() - interval '1 hour');

select public.backfill_broadcasts_into_threads();
select public.backfill_broadcasts_into_threads();

select is(
  (select count(*)::int from public.messages
    where broadcast_id = 'b1b1b1b1-0000-0000-0000-000000000001'),
  1,
  'a broadcast backfills to exactly one message, however many times it runs'
);

select is(
  (select t.event_id from public.messages m
     join public.message_threads t on t.id = m.thread_id
    where m.broadcast_id = 'b1b1b1b1-0000-0000-0000-000000000001'),
  'e1e1e1e1-0000-0000-0000-000000000001'::uuid,
  'an event-targeted broadcast lands in that event''s thread, not the club''s'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select public.post_message(
  public.open_thread_for_event('e1e1e1e1-0000-0000-0000-000000000001'),
  'Running ten minutes late.');

select is(
  (select count(*)::int from public.fetch_my_threads() where kind = 'game'),
  1,
  'a game thread appears once somebody posts in it'
);

-- Past the 24-hour window it drops off, messages or no messages.
select public.post_message(
  public.open_thread_for_event('e2e2e2e2-0000-0000-0000-000000000002'),
  'Good game.');

select is(
  (select count(*)::int from public.fetch_my_threads()
    where event_id = 'e2e2e2e2-0000-0000-0000-000000000002'),
  0,
  'a game that ended more than a day ago falls off the list'
);

-- Your own message is never unread.
select is(
  (select unread from public.fetch_my_threads() where kind = 'game'),
  0,
  'your own message does not make a thread unread'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select unread from public.fetch_my_threads() where kind = 'game'),
  1,
  'somebody else''s message is unread'
);

select public.mark_thread_read(
  (select thread_id from public.fetch_my_threads() where kind = 'game'));

select is(
  (select unread from public.fetch_my_threads() where kind = 'game'),
  0,
  'and marking it read clears it'
);

select * from finish();
rollback;
