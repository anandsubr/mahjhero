begin;
set local search_path to extensions, public;
select plan(6);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ec01', 'ig-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000ec02', 'ig-member@example.com'),
  ('cccccccc-0000-0000-0000-00000000ec03', 'ig-friend@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ec01', 'Gate Club', 'gate-club',
   'aaaaaaaa-0000-0000-0000-00000000ec01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ec01',
   'aaaaaaaa-0000-0000-0000-00000000ec01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000ec01',
   'bbbbbbbb-0000-0000-0000-00000000ec02', 'member'),
  ('c1c1c1c1-0000-0000-0000-00000000ec01',
   'cccccccc-0000-0000-0000-00000000ec03', 'member');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000ec01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000ec01',
   'aaaaaaaa-0000-0000-0000-00000000ec01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, game_mode, status, created_by
) values (
  '22222222-0000-0000-0000-00000000ec01', 'c1c1c1c1-0000-0000-0000-00000000ec01',
  'Private Game', '11111111-0000-0000-0000-00000000ec01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only', 'published',
  'aaaaaaaa-0000-0000-0000-00000000ec01'
);

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('44444444-0000-0000-0000-00000000ec01', '22222222-0000-0000-0000-00000000ec01',
   'c1c1c1c1-0000-0000-0000-00000000ec01', 'Table 1', 1);

-- A plain member cannot book themselves onto the private game.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000ec02", "role": "authenticated"}';

select throws_ok(
  $$select public.commit_booking('22222222-0000-0000-0000-00000000ec01',
      array['bbbbbbbb-0000-0000-0000-00000000ec02']::uuid[], null, true)$$,
  '42501',
  null,
  'a plain member cannot self-book onto an invite-only game'
);

select throws_ok(
  $$select public.propose_booking('22222222-0000-0000-0000-00000000ec01',
      array['bbbbbbbb-0000-0000-0000-00000000ec02']::uuid[], null, true)$$,
  '42501',
  null,
  'a plain member cannot even propose a booking onto an invite-only game'
);

-- A plain member cannot bring a friend onto it either.
select throws_ok(
  $$select public.commit_booking('22222222-0000-0000-0000-00000000ec01',
      array['cccccccc-0000-0000-0000-00000000ec03']::uuid[], null, true)$$,
  '42501',
  null,
  'a plain member cannot bring someone else onto an invite-only game either'
);

-- The organizer CAN book a member in.
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000ec01", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking('22222222-0000-0000-0000-00000000ec01',
      array['bbbbbbbb-0000-0000-0000-00000000ec02']::uuid[],
      '44444444-0000-0000-0000-00000000ec01', true)$$,
  'the organizer can invite (book) a member onto an invite-only game'
);

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000ec01'
     and profile_id = 'bbbbbbbb-0000-0000-0000-00000000ec02'
     and status = 'confirmed'),
  1,
  'the invited member is actually seated'
);

-- An open_play event is unaffected -- the member can still self-book.
set local role postgres;
reset request.jwt.claims;
update public.events set game_mode = 'open_play'
where id = '22222222-0000-0000-0000-00000000ec01';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000ec03", "role": "authenticated"}';

select lives_ok(
  $$select public.commit_booking('22222222-0000-0000-0000-00000000ec01',
      array['cccccccc-0000-0000-0000-00000000ec03']::uuid[], null, true)$$,
  'open_play events are unaffected -- a plain member can still self-book'
);

select * from finish();
rollback;
