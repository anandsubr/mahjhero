begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(20);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member');

-- Riverside's own venue, and Oakfield's private one.
insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000009', 'Bob''s kitchen',
   'c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- Creation.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-09-07 23:00+00', '2027-09-08 02:00+00', 3)$$,
  'an organizer can create an event'
);

select is(
  (select count(*)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game'),
  3,
  'the requested number of tables is created'
);

select is(
  (select count(distinct capacity)::int || ':' || max(capacity)::text
   from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game'),
  '1:4',
  'every table seats four'
);

select is(
  (select skill_tier::text from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game' and t.position = 1),
  'mixed',
  'tables default to the mixed tier'
);

-- The venue guard. Another club's private venue is not reachable, even
-- though this caller is a legitimate organizer of their own club.
select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Smuggled venue',
      '11111111-0000-0000-0000-000000000009', '',
      '2027-09-07 23:00+00', '2027-09-08 02:00+00', 1)$$,
  '42501',
  null,
  'an organizer cannot attach another club''s private venue'
);

-- The role guard.
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Member''s event',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-09-07 23:00+00', '2027-09-08 02:00+00', 1)$$,
  '42501',
  null,
  'a plain member cannot create an event'
);

-- The club guard.
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Bob''s intrusion',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-09-07 23:00+00', '2027-09-08 02:00+00', 1)$$,
  '42501',
  null,
  'a host of another club cannot create an event here'
);

-- ---------------------------------------------------------------------
-- Editing, and the overrides it records.
-- ---------------------------------------------------------------------
set local role postgres;

insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  starts_on, created_by
) values (
  '55555555-0000-0000-0000-000000000001',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Weekly game',
  '11111111-0000-0000-0000-000000000001',
  'weekly', 2::smallint, '19:00', '2027-09-01',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

insert into public.events (
  id, club_id, series_id, title, venue_id, starts_at, ends_at,
  occurrence_date, created_by
) values (
  'e1e1e1e1-0000-0000-0000-000000000001',
  'c1c1c1c1-0000-0000-0000-000000000001',
  '55555555-0000-0000-0000-000000000001', 'Weekly game',
  '11111111-0000-0000-0000-000000000001',
  '2027-09-07 23:00+00', '2027-09-08 02:00+00', '2027-09-07',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000002', 'Marie''s place',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event(
      'e1e1e1e1-0000-0000-0000-000000000001', null,
      '11111111-0000-0000-0000-000000000002', null, null, null)$$,
  'an organizer can move one occurrence to a different venue'
);

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  $$values (array['venue_id'])$$,
  'only the field that actually changed is recorded as an override'
);

select is(
  (select title from public.events
   where id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  'Weekly game',
  'a null argument left the title alone'
);

-- Editing the same field twice must not duplicate the key.
select lives_ok(
  $$select public.update_event(
      'e1e1e1e1-0000-0000-0000-000000000001', null,
      '11111111-0000-0000-0000-000000000001', null, null, null)$$,
  'the venue can be changed again'
);

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  $$values (array['venue_id'])$$,
  'the override list does not accumulate duplicates'
);

-- A one-off event records no overrides — it has no series to diverge from.
select lives_ok(
  $$select public.update_event(
      (select id from public.events where title = 'Tuesday game'),
      'Tuesday game, moved', null, null, null, null)$$,
  'a one-off event can be edited'
);

select results_eq(
  $$select overrides from public.events
    where title = 'Tuesday game, moved'$$,
  $$values (array[]::text[])$$,
  'a one-off event records no overrides'
);

-- ---------------------------------------------------------------------
-- Cancellation, and what it forbids.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.cancel_event('e1e1e1e1-0000-0000-0000-000000000001')$$,
  'an organizer can cancel an event'
);

select throws_ok(
  $$select public.update_event(
      'e1e1e1e1-0000-0000-0000-000000000001', 'Resurrected',
      null, null, null, null)$$,
  '42501',
  null,
  'a cancelled event cannot be edited'
);

-- ---------------------------------------------------------------------
-- Tables.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.add_event_table(
      (select id from public.events where title = 'Tuesday game, moved'))$$,
  'an organizer can add a table'
);

select is(
  (select max(position)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game, moved'),
  4,
  'the new table takes the next position'
);

select lives_ok(
  $$select public.update_event_table(
      (select t.id from public.event_tables t
       join public.events e on e.id = t.event_id
       where e.title = 'Tuesday game, moved' and t.position = 1),
      'Beginners'' table', 'beginner')$$,
  'an organizer can retier a table'
);

select is(
  (select skill_tier::text from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Tuesday game, moved' and t.position = 1),
  'beginner',
  'the tier landed'
);

select * from finish();
rollback;
