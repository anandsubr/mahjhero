begin;
set local search_path to extensions, public;

select plan(12);

-- Alice hosts Riverside. Bob is a member with a confirmed seat. Carol is a
-- member on the waitlist. Dave is a member with no seat. Erin is a stranger.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
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
   'cccccccc-0000-0000-0000-000000000003', 'member', 'active'),
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

insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002');
insert into public.booking_groups
  (id, event_id, club_id, created_by, status, waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'waitlisted', now());

insert into public.bookings (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  ('9909aaaa-0000-0000-0000-000000000002',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003', 'waitlisted');

insert into public.message_threads (id, club_id) values
  ('11111111-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001');
insert into public.message_threads (id, club_id, event_id) values
  ('22222222-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001');
insert into public.message_threads (id, title, created_by) values
  ('33333333-0000-0000-0000-000000000003', 'Tuesday four',
   'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.thread_members (thread_id, profile_id) values
  ('33333333-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002');

-- A helper so each assertion reads as one question.
create function pg_temp.as_user(u uuid, q text) returns boolean
language plpgsql as $$
declare r boolean;
begin
  execute format('set local request.jwt.claims = %L',
                 json_build_object('sub', u, 'role', 'authenticated')::text);
  execute q into r;
  return r;
end;
$$;

-- Club thread: any active member reads and posts; a stranger does neither.
select ok(
  pg_temp.as_user('dddddddd-0000-0000-0000-000000000004',
    $$select public.can_post_thread('11111111-0000-0000-0000-000000000001')$$),
  'any active club member posts in the club thread'
);
select ok(
  not pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005',
    $$select public.can_read_thread('11111111-0000-0000-0000-000000000001')$$),
  'a stranger cannot read the club thread'
);

-- Game thread: confirmed reads and posts.
select ok(
  pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002',
    $$select public.can_post_thread('22222222-0000-0000-0000-000000000002')$$),
  'a confirmed seat posts in the game thread'
);

-- Waitlisted reads and does NOT post. They have no seat, so the thread is
-- information rather than a conversation they are part of.
select ok(
  pg_temp.as_user('cccccccc-0000-0000-0000-000000000003',
    $$select public.can_read_thread('22222222-0000-0000-0000-000000000002')$$),
  'a waitlisted member reads the game thread'
);
select ok(
  not pg_temp.as_user('cccccccc-0000-0000-0000-000000000003',
    $$select public.can_post_thread('22222222-0000-0000-0000-000000000002')$$),
  'a waitlisted member does not post in the game thread'
);

-- A club member with no seat at all is not in the game thread.
select ok(
  not pg_temp.as_user('dddddddd-0000-0000-0000-000000000004',
    $$select public.can_read_thread('22222222-0000-0000-0000-000000000002')$$),
  'a club member with no seat cannot read the game thread'
);

-- An organizer is always in, seat or no seat.
select ok(
  pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001',
    $$select public.can_post_thread('22222222-0000-0000-0000-000000000002')$$),
  'an organizer posts in the game thread without a seat'
);

-- Group thread: membership and nothing else. The host of the club is not
-- privileged here — a group is not the club's business.
select ok(
  pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002',
    $$select public.can_post_thread('33333333-0000-0000-0000-000000000003')$$),
  'a group member posts in the group thread'
);
select ok(
  not pg_temp.as_user('cccccccc-0000-0000-0000-000000000003',
    $$select public.can_read_thread('33333333-0000-0000-0000-000000000003')$$),
  'a club-mate who is not in the group cannot read it'
);

-- RLS actually applies the predicate.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';

select is(
  (select count(*)::int from public.message_threads),
  1,
  'a seatless club member sees the club thread and nothing else'
);

set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select is(
  (select count(*)::int from public.message_threads),
  0,
  'a stranger sees no threads at all'
);

-- No write policy on any of them.
select throws_ok(
  $$insert into public.messages (thread_id, author_id, body)
    values ('11111111-0000-0000-0000-000000000001',
            'eeeeeeee-0000-0000-0000-000000000005', 'hello')$$,
  '42501',
  null,
  'nobody writes a message directly'
);

select * from finish();
rollback;
