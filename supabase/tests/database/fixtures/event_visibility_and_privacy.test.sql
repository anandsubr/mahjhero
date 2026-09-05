begin;
set local search_path to extensions, public;
select plan(10);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ea01', 'ev-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000ea02', 'ev-member@example.com'),
  ('cccccccc-0000-0000-0000-00000000ea03', 'ev-outsider@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ea01', 'Visibility Club', 'visibility-club',
   'aaaaaaaa-0000-0000-0000-00000000ea01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ea01',
   'aaaaaaaa-0000-0000-0000-00000000ea01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000ea01',
   'bbbbbbbb-0000-0000-0000-00000000ea02', 'member'),
  ('c1c1c1c1-0000-0000-0000-00000000ea01',
   'cccccccc-0000-0000-0000-00000000ea03', 'member');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000ea01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000ea01', 'aaaaaaaa-0000-0000-0000-00000000ea01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, game_mode, created_by
) values (
  '22222222-0000-0000-0000-00000000ea01', 'c1c1c1c1-0000-0000-0000-00000000ea01',
  'Private Game', '11111111-0000-0000-0000-00000000ea01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only',
  'aaaaaaaa-0000-0000-0000-00000000ea01'
);

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('44444444-0000-0000-0000-00000000ea01', '22222222-0000-0000-0000-00000000ea01',
   'c1c1c1c1-0000-0000-0000-00000000ea01', 'Table 1', 1);

-- Bob is invited-and-booked but not yet placed at a table.
insert into public.booking_groups (id, event_id, club_id, created_by, status) values
  ('55555555-0000-0000-0000-00000000ea01', '22222222-0000-0000-0000-00000000ea01',
   'c1c1c1c1-0000-0000-0000-00000000ea01',
   'aaaaaaaa-0000-0000-0000-00000000ea01', 'confirmed');
insert into public.bookings (group_id, event_id, club_id, profile_id, booked_by) values
  ('55555555-0000-0000-0000-00000000ea01', '22222222-0000-0000-0000-00000000ea01',
   'c1c1c1c1-0000-0000-0000-00000000ea01',
   'bbbbbbbb-0000-0000-0000-00000000ea02',
   'aaaaaaaa-0000-0000-0000-00000000ea01');

-- Outsider (Carol) is a club member but never invited to this private game.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000ea03", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where id = '22222222-0000-0000-0000-00000000ea01'),
  0,
  'an uninvited member cannot see the invite-only event at all'
);

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000ea01')),
  0,
  'event_seating returns nothing to an uninvited member'
);

select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000ea01'),
  null,
  'event_accepted_count returns null to someone who cannot see the event'
);

-- Bob: invited and booked, but not yet placed at a table.
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000ea02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where id = '22222222-0000-0000-0000-00000000ea01'),
  1,
  'an invited-and-booked member can see the private event'
);

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000ea01')),
  1,
  'a not-yet-placed invitee sees only their own booking via event_seating'
);

select is(
  (select profile_id from public.event_seating(
     '22222222-0000-0000-0000-00000000ea01')),
  'bbbbbbbb-0000-0000-0000-00000000ea02'::uuid,
  'the one row a not-yet-placed invitee sees is their own'
);

select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000ea01'),
  1,
  'a not-yet-placed invitee still gets the headcount'
);

-- Now place Bob at a table -- the full list should unlock for him.
set local role postgres;
reset request.jwt.claims;
update public.bookings set event_table_id = '44444444-0000-0000-0000-00000000ea01'
where group_id = '55555555-0000-0000-0000-00000000ea01';

-- A second, still-unplaced invitee (Carol, now invited) so there is
-- something for placement to unlock visibility of.
insert into public.booking_groups (id, event_id, club_id, created_by, status) values
  ('66666666-0000-0000-0000-00000000ea01', '22222222-0000-0000-0000-00000000ea01',
   'c1c1c1c1-0000-0000-0000-00000000ea01',
   'aaaaaaaa-0000-0000-0000-00000000ea01', 'confirmed');
insert into public.bookings (group_id, event_id, club_id, profile_id, booked_by) values
  ('66666666-0000-0000-0000-00000000ea01', '22222222-0000-0000-0000-00000000ea01',
   'c1c1c1c1-0000-0000-0000-00000000ea01',
   'cccccccc-0000-0000-0000-00000000ea03',
   'aaaaaaaa-0000-0000-0000-00000000ea01');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000ea02", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000ea01')),
  2,
  'once placed at a table, the invitee sees every booking for the event'
);

-- Organizer always sees everything, placed or not.
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000ea01", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_seating(
     '22222222-0000-0000-0000-00000000ea01')),
  2,
  'the organizer sees every booking regardless of placement'
);

select is(
  public.event_accepted_count('22222222-0000-0000-0000-00000000ea01'),
  2,
  'the organizer gets the correct headcount too'
);

select * from finish();
rollback;
