begin;
set local search_path to extensions, public;

select plan(6);

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000031', 'host31@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('b0000000-0000-0000-0000-000000000031', 'Cap Club', 'cap-club',
          'America/New_York', 'a0000000-0000-0000-0000-000000000031');
insert into public.club_members (club_id, profile_id, role, status) values
  ('b0000000-0000-0000-0000-000000000031',
   'a0000000-0000-0000-0000-000000000031', 'host', 'active')
  on conflict do nothing;
insert into public.venues (id, added_by_club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000031',
          'b0000000-0000-0000-0000-000000000031', 'Hall',
          'a0000000-0000-0000-0000-000000000031');

-- Three events: today's behavior, capped open seating, uncapped open seating.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, seating_mode, capacity,
   created_by)
values
  ('d0000000-0000-0000-0000-000000000031',
   'b0000000-0000-0000-0000-000000000031', 'Assigned',
   'c0000000-0000-0000-0000-000000000031',
   now() + interval '1 day', now() + interval '1 day 3 hours',
   'assigned_tables', null, 'a0000000-0000-0000-0000-000000000031'),
  ('d0000000-0000-0000-0000-000000000032',
   'b0000000-0000-0000-0000-000000000031', 'Capped open',
   'c0000000-0000-0000-0000-000000000031',
   now() + interval '1 day', now() + interval '1 day 3 hours',
   'open_seating', 60, 'a0000000-0000-0000-0000-000000000031'),
  ('d0000000-0000-0000-0000-000000000033',
   'b0000000-0000-0000-0000-000000000031', 'Uncapped open',
   'c0000000-0000-0000-0000-000000000031',
   now() + interval '1 day', now() + interval '1 day 3 hours',
   'open_seating', null, 'a0000000-0000-0000-0000-000000000031');

-- The assigned event keeps deriving from tables, exactly as before.
insert into public.event_tables (event_id, club_id, label, position)
values ('d0000000-0000-0000-0000-000000000031',
        'b0000000-0000-0000-0000-000000000031', 'Table 1', 1);

select is(public.event_capacity('d0000000-0000-0000-0000-000000000031'), 4,
  'assigned_tables still sums event_tables');
select is(public.event_capacity('d0000000-0000-0000-0000-000000000032'), 60,
  'capped open seating uses the explicit capacity');

select ok(public.event_is_capped('d0000000-0000-0000-0000-000000000031'),
  'an assigned-tables event is capped');
select ok(public.event_is_capped('d0000000-0000-0000-0000-000000000032'),
  'open seating with a number is capped');
select ok(not public.event_is_capped('d0000000-0000-0000-0000-000000000033'),
  'open seating with no number is uncapped');

-- The whole point: with zero tables and no cap, a booking is SEATED, not
-- waitlisted. Under the old derived-capacity rule this returned 'waitlisted'
-- because capacity was 0.
select is(
  public.plan_seating('d0000000-0000-0000-0000-000000000033',
                      array['a0000000-0000-0000-0000-000000000031'::uuid],
                      null, true) ->> 'outcome',
  'seated',
  'an uncapped open-seating event seats rather than waitlists');

select * from finish();
rollback;
