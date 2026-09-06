begin;
set local search_path to extensions, public;

select plan(9);

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000041', 'host41@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('b0000000-0000-0000-0000-000000000041', 'Open Club', 'open-club',
          'America/New_York', 'a0000000-0000-0000-0000-000000000041');
insert into public.club_members (club_id, profile_id, role, status) values
  ('b0000000-0000-0000-0000-000000000041',
   'a0000000-0000-0000-0000-000000000041', 'host', 'active')
  on conflict do nothing;
insert into public.venues (id, added_by_club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000041',
          'b0000000-0000-0000-0000-000000000041', 'Hall',
          'a0000000-0000-0000-0000-000000000041');

set local role authenticated;
set local request.jwt.claims to
  '{"sub": "a0000000-0000-0000-0000-000000000041", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- create_event: seating mode and capacity.
-- ---------------------------------------------------------------------

select lives_ok(
  $$select public.create_event(
      'b0000000-0000-0000-0000-000000000041'::uuid, 'Big night',
      'c0000000-0000-0000-0000-000000000041'::uuid, '',
      (current_date + 7), '19:00'::time, 180, 0, true, 0, 0, null,
      'open_seating'::public.seating_mode, 60)$$,
  'an open-seating event may be created with zero tables');

create temporary table open_event on commit drop as
  select public.create_event(
    'b0000000-0000-0000-0000-000000000041'::uuid, 'Big night 2',
    'c0000000-0000-0000-0000-000000000041'::uuid, '',
    (current_date + 7), '19:30'::time, 180, 0, true, 0, 0, null,
    'open_seating'::public.seating_mode, 60
  ) as id;

select is(
  (select count(*)::int from public.event_tables
    where event_id = (select id from open_event)),
  0,
  'and creates zero event_tables rows'
);

select throws_ok(
  $$select public.create_event(
      'b0000000-0000-0000-0000-000000000041'::uuid, 'Bad night',
      'c0000000-0000-0000-0000-000000000041'::uuid, '',
      (current_date + 7), '19:00'::time, 180, 0, true, 0, 0, null,
      'assigned_tables'::public.seating_mode, null)$$,
  '23514', null,
  'an assigned-tables event still requires at least one table');

select throws_ok(
  $$select public.create_event(
      'b0000000-0000-0000-0000-000000000041'::uuid, 'Negative capacity',
      'c0000000-0000-0000-0000-000000000041'::uuid, '',
      (current_date + 7), '19:00'::time, 180, 1, true, 0, 0, null,
      'assigned_tables'::public.seating_mode, -5)$$,
  '23514', null,
  'a negative capacity is rejected');

-- ---------------------------------------------------------------------
-- remove_event_table: the last-table floor applies only to
-- assigned_tables; open seating may be stripped to zero tables.
-- ---------------------------------------------------------------------

create temporary table assigned_event on commit drop as
  select public.create_event(
    'b0000000-0000-0000-0000-000000000041'::uuid, 'Assigned night',
    'c0000000-0000-0000-0000-000000000041'::uuid, '',
    (current_date + 8), '19:00'::time, 180, 1, true, 0, 0, null,
    'assigned_tables'::public.seating_mode, null
  ) as id;

create temporary table open_event2 on commit drop as
  select public.create_event(
    'b0000000-0000-0000-0000-000000000041'::uuid, 'Open night',
    'c0000000-0000-0000-0000-000000000041'::uuid, '',
    (current_date + 8), '19:30'::time, 180, 1, true, 0, 0, null,
    'open_seating'::public.seating_mode, 60
  ) as id;

-- One confirmed booking on each event's only table, so removal must unseat
-- rather than destroy it in both cases. Seeded directly as an admin, the
-- same way event_disruption.test.sql does, since authenticated has no
-- direct INSERT grant on these tables (booking creation goes through the
-- propose_booking/commit_booking RPCs elsewhere).
reset role;
insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('9909aaaa-0000-0000-0000-000000000041',
   (select id from assigned_event),
   'b0000000-0000-0000-0000-000000000041',
   'a0000000-0000-0000-0000-000000000041'),
  ('9909aaaa-0000-0000-0000-000000000042',
   (select id from open_event2),
   'b0000000-0000-0000-0000-000000000041',
   'a0000000-0000-0000-0000-000000000041');

insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values
  ('b00c0000-0000-0000-0000-000000000041',
   '9909aaaa-0000-0000-0000-000000000041',
   (select id from assigned_event),
   'b0000000-0000-0000-0000-000000000041',
   (select id from public.event_tables
     where event_id = (select id from assigned_event) limit 1),
   'a0000000-0000-0000-0000-000000000041',
   'a0000000-0000-0000-0000-000000000041'),
  ('b00c0000-0000-0000-0000-000000000042',
   '9909aaaa-0000-0000-0000-000000000042',
   (select id from open_event2),
   'b0000000-0000-0000-0000-000000000041',
   (select id from public.event_tables
     where event_id = (select id from open_event2) limit 1),
   'a0000000-0000-0000-0000-000000000041',
   'a0000000-0000-0000-0000-000000000041');

set local role authenticated;
set local request.jwt.claims to
  '{"sub": "a0000000-0000-0000-0000-000000000041", "role": "authenticated"}';

select throws_ok(
  format(
    $$select public.remove_event_table(
        (select id from public.event_tables where event_id = %L limit 1))$$,
    (select id from assigned_event)),
  '23514', null,
  'removing the only table on an assigned-tables event still raises');

reset role;
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000041'),
  (select id from public.event_tables
    where event_id = (select id from assigned_event) limit 1),
  'and that booking keeps its table, since the removal never happened'
);

set local role authenticated;
set local request.jwt.claims to
  '{"sub": "a0000000-0000-0000-0000-000000000041", "role": "authenticated"}';

select lives_ok(
  format(
    $$select public.remove_event_table(
        (select id from public.event_tables where event_id = %L limit 1))$$,
    (select id from open_event2)),
  'removing the only table on an open-seating event succeeds');

reset role;
select is(
  (select count(*)::int from public.event_tables
    where event_id = (select id from open_event2)),
  0,
  'and the open-seating event is left with zero tables'
);

select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000042'),
  null,
  'and that booking is unseated (event_table_id null), not deleted'
);

select * from finish();
rollback;
