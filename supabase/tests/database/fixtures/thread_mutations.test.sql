begin;
set local search_path to extensions, public;

select plan(6);

-- Alice hosts Riverside. Bob has a confirmed seat. Dave is a member with no
-- seat. Erin is a stranger.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dave@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004', 'member', 'active');

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

-- bookings.group_id is not null, referencing booking_groups, whose check
-- constraint requires waitlisted_at set iff status = 'waitlisted'. The
-- brief's fixture omits this group (schema disagreement — see report);
-- the seed pattern below matches waitlist_promotion.test.sql.
insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.bookings (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

-- Idempotent by construction: the partial unique index is what makes the
-- second call return the first call's row rather than create a rival.
select is(
  public.open_thread_for_club('c1c1c1c1-0000-0000-0000-000000000001'),
  public.open_thread_for_club('c1c1c1c1-0000-0000-0000-000000000001'),
  'opening a club thread twice returns the same thread'
);

select is(
  (select count(*)::int from public.message_threads
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
      and event_id is null),
  1,
  'and it created exactly one row'
);

select is(
  public.open_thread_for_event('e1e1e1e1-0000-0000-0000-000000000001'),
  public.open_thread_for_event('e1e1e1e1-0000-0000-0000-000000000001'),
  'opening a game thread twice returns the same thread'
);

set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select throws_ok(
  $$select public.open_thread_for_club('c1c1c1c1-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a stranger cannot open a club thread'
);

-- A club member with no seat is not part of the game. The organizer is,
-- which is what lets a host message the table they are running.
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select throws_ok(
  $$select public.open_thread_for_event('e1e1e1e1-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a club member with no seat cannot open the game thread'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.open_thread_for_event('e1e1e1e1-0000-0000-0000-000000000001')$$,
  'an organizer opens the game thread without a seat'
);

select * from finish();
rollback;
