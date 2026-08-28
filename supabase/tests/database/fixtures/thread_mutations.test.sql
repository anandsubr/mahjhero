begin;
set local search_path to extensions, public;

select plan(14);

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

-- Frank shares no club with anyone. Bob friends him from a club they were
-- both in and which Frank has since left — the cross-club case the whole
-- friends edge exists for.
insert into auth.users (id, email) values
  ('ffffffff-0000-0000-0000-000000000006', 'frank@example.com');
insert into public.friendships (profile_id, friend_id) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'ffffffff-0000-0000-0000-000000000006');

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

-- Groups.
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select lives_ok(
  $$select public.create_group_thread('Tuesday four',
      array['dddddddd-0000-0000-0000-000000000004'::uuid,
            'ffffffff-0000-0000-0000-000000000006'::uuid])$$,
  'a group can mix a club-mate and a friend from no shared club'
);

select throws_ok(
  $$select public.create_group_thread(null,
      array['eeeeeeee-0000-0000-0000-000000000005'::uuid])$$,
  '42501',
  null,
  'somebody you can neither reach nor friend cannot be put in a group'
);

select throws_ok(
  $$select public.create_group_thread(null, array[]::uuid[])$$,
  '22023',
  null,
  'a group with nobody in it is refused'
);

-- A one-person pick is a direct message, and picking the same person twice
-- returns the same conversation rather than a second one.
select is(
  public.create_group_thread(null,
    array['dddddddd-0000-0000-0000-000000000004'::uuid]),
  public.create_group_thread(null,
    array['dddddddd-0000-0000-0000-000000000004'::uuid]),
  'picking one person twice reopens the same direct thread'
);

-- Passing yourself must not turn a direct into a three-person group.
select is(
  public.create_group_thread(null,
    array['dddddddd-0000-0000-0000-000000000004'::uuid,
          'bbbbbbbb-0000-0000-0000-000000000002'::uuid]),
  public.create_group_thread(null,
    array['dddddddd-0000-0000-0000-000000000004'::uuid]),
  'passing yourself in the member list changes nothing'
);

-- Anyone in the group can add; nobody can remove anybody.
select lives_ok(
  $$select public.add_to_group_thread(
      (select id from public.message_threads
        where title = 'Tuesday four' limit 1),
      array['aaaaaaaa-0000-0000-0000-000000000001'::uuid])$$,
  'a member adds somebody they can reach'
);

-- message_threads_select is `using (can_read_thread(id))`, and a group's
-- read rule is bare membership — so once the JWT below switches to Erin,
-- a `select id from message_threads where title = 'Tuesday four'` returns
-- no row at all under her own RLS, not the row to be refused. Capture the
-- id now, while still Bob (a member, so the select is legitimately
-- visible to him), into a temp table: unlike message_threads itself, a
-- session-local temp table carries no RLS policy, so it stays readable
-- after the JWT switch below.
create temporary table _tuesday_four as
  select id from public.message_threads where title = 'Tuesday four' limit 1;

set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

select throws_ok(
  $$select public.add_to_group_thread(
      (select id from _tuesday_four limit 1),
      array['eeeeeeee-0000-0000-0000-000000000005'::uuid])$$,
  '42501',
  null,
  'somebody outside the group cannot add themselves to it'
);

-- Last member out takes the thread with them: nobody could ever reach it
-- again, so leaving it behind is litter with a permission check on it.
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

-- The brief's do-block used `$$ ... $x$ ... $x$$$` for the outer lives_ok
-- literal and the inner do-block body. Postgres dollar-quoting matches on
-- the literal delimiter substring, not on balanced tag nesting, so the
-- trailing `$x$$$` is read as `$x$` (closes the inner do-block) followed by
-- `$$` (closes the OUTER `$$` two characters early) with a stray `$`
-- left over — `syntax error at or near "$"`, confirmed against this local
-- stack. Using a distinct outer tag (`$test$`) that shares no substring
-- with the inner `$x$` avoids the collision entirely.
select lives_ok(
  $test$do $x$
    declare t uuid;
    begin
      select public.create_group_thread('Doomed',
        array['dddddddd-0000-0000-0000-000000000004'::uuid]) into t;
      perform public.leave_group_thread(t);
      perform set_config('request.jwt.claims',
        '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}',
        true);
      perform public.leave_group_thread(t);
      if exists (select 1 from public.message_threads where id = t) then
        raise exception 'the thread outlived its last member';
      end if;
    end
  $x$$test$,
  'the last member out deletes the thread'
);

select * from finish();
rollback;
