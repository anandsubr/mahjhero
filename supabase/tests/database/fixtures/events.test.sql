begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(40);

select has_table('public', 'event_series', 'event_series table exists');
select has_table('public', 'events', 'events table exists');
select has_table('public', 'event_tables', 'event_tables table exists');

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday game',
   '11111111-0000-0000-0000-000000000001',
   '2026-09-01 23:00+00', '2026-09-02 02:00+00',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Draft game',
   '11111111-0000-0000-0000-000000000001',
   '2026-09-08 23:00+00', '2026-09-09 02:00+00',
   'aaaaaaaa-0000-0000-0000-000000000001');

update public.events set status = 'draft'
  where id = 'e1e1e1e1-0000-0000-0000-000000000002';

insert into public.event_tables (event_id, club_id, label, position) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 1);

-- ---------------------------------------------------------------------
-- Structural guarantees, asserted as the owner.
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.event_tables (event_id, club_id, label, position)
    values ('e1e1e1e1-0000-0000-0000-000000000001',
            'c2c2c2c2-0000-0000-0000-000000000002', 'Smuggled', 2)$$,
  '23503',
  null,
  'a table cannot claim a club its event does not belong to'
);

select throws_ok(
  $$insert into public.event_tables (event_id, club_id, label, position)
    values ('e1e1e1e1-0000-0000-0000-000000000001',
            'c1c1c1c1-0000-0000-0000-000000000001', 'Duplicate', 1)$$,
  '23505',
  null,
  'two tables cannot share a position on one event'
);

select throws_ok(
  $$insert into public.events (club_id, title, venue_id, starts_at, ends_at,
      occurrence_date, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'Orphan occurrence',
      '11111111-0000-0000-0000-000000000001',
      '2026-09-15 23:00+00', '2026-09-16 02:00+00', '2026-09-15',
      'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'an occurrence_date without a series_id is rejected'
);

select throws_ok(
  $$insert into public.events (club_id, title, venue_id, starts_at, ends_at,
      overrides, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'Bad override',
      '11111111-0000-0000-0000-000000000001',
      '2026-09-15 23:00+00', '2026-09-16 02:00+00', array['capacity'],
      'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'an unrecognised override key is rejected'
);

select throws_ok(
  $$insert into public.events (club_id, title, venue_id, starts_at, ends_at,
      created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'Backwards',
      '11111111-0000-0000-0000-000000000001',
      '2026-09-15 23:00+00', '2026-09-15 22:00+00',
      'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'an event that ends before it starts is rejected'
);

-- ---------------------------------------------------------------------
-- RLS: the club boundary, and the draft boundary.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  0,
  'another club cannot read this club''s events'
);

select is(
  (select count(*)::int from public.event_tables
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  0,
  'another club cannot read this club''s tables'
);

select is(
  (select count(*)::int from public.event_series
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  0,
  'another club cannot read this club''s series'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  2,
  'an organizer sees published and draft events'
);

select is(
  (select count(*)::int from public.event_tables
   where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  1,
  'a member of the club can read its tables'
);

-- Demote Alice to a plain member and re-ask about the draft.
set local role postgres;
update public.club_members set role = 'member'
  where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  1,
  'a plain member sees published events and not drafts'
);

-- ---------------------------------------------------------------------
-- Clients read and never write. Every mutation is a function.
-- ---------------------------------------------------------------------
select ok(
  has_table_privilege('authenticated', 'public.events', 'SELECT'),
  'authenticated can select events'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'INSERT'),
  'authenticated cannot insert events directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'UPDATE'),
  'authenticated cannot update events directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_tables', 'INSERT'),
  'authenticated cannot insert event_tables directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_series', 'INSERT'),
  'authenticated cannot insert event_series directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.events', 'TRUNCATE'),
  'authenticated cannot TRUNCATE events'
);

-- ---------------------------------------------------------------------
-- event_series: the checks that this fixture never exercised (fix pass 1).
-- Everything below runs as the table owner unless a role switch says
-- otherwise -- there is no insert policy on any of these tables, so
-- fixture writes always go in as postgres.
-- ---------------------------------------------------------------------
set local role postgres;

select throws_ok(
  $$insert into public.event_series
    (club_id, title, venue_id, frequency, weekday, start_time, starts_on,
     created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'Bad monthly',
      '11111111-0000-0000-0000-000000000001', 'monthly_nth_weekday', 2,
      '19:00', '2026-09-01', 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'monthly_nth_weekday requires nth_week to be set'
);

select throws_ok(
  $$insert into public.event_series
    (club_id, title, venue_id, frequency, weekday, nth_week, start_time,
     starts_on, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'Bad weekly',
      '11111111-0000-0000-0000-000000000001', 'weekly', 2, 2,
      '19:00', '2026-09-01', 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'nth_week must stay null when frequency is not monthly_nth_weekday'
);

select throws_ok(
  $$insert into public.event_series
    (club_id, title, venue_id, frequency, weekday, start_time, starts_on,
     ends_on, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'Backwards series',
      '11111111-0000-0000-0000-000000000001', 'weekly', 2, '19:00',
      '2026-09-08', '2026-09-01', 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'a series cannot end before it starts'
);

-- ---------------------------------------------------------------------
-- The partial unique index that makes materialization idempotent.
-- ---------------------------------------------------------------------
insert into public.event_series
  (id, club_id, title, venue_id, frequency, weekday, start_time, starts_on,
   created_by)
values
  ('55555555-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Weekly Tuesday',
   '11111111-0000-0000-0000-000000000001', 'weekly', 2, '19:00',
   '2026-09-01', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, series_id, title, venue_id, starts_at, ends_at,
   occurrence_date, created_by)
values
  ('e1e1e1e1-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000001',
   'Materialized Tuesday', '11111111-0000-0000-0000-000000000001',
   '2026-09-08 23:00+00', '2026-09-09 02:00+00', '2026-09-08',
   'aaaaaaaa-0000-0000-0000-000000000001');

select throws_ok(
  $$insert into public.events
    (club_id, series_id, title, venue_id, starts_at, ends_at,
     occurrence_date, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001',
      '55555555-0000-0000-0000-000000000001', 'Duplicate occurrence',
      '11111111-0000-0000-0000-000000000001',
      '2026-09-08 23:00+00', '2026-09-09 02:00+00', '2026-09-08',
      'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23505',
  null,
  'two occurrences of the same series on the same date are rejected'
);

select lives_ok(
  $$insert into public.events (club_id, title, venue_id, starts_at, ends_at,
      created_by)
    values
      ('c1c1c1c1-0000-0000-0000-000000000001', 'One-off A',
        '11111111-0000-0000-0000-000000000001',
        '2026-09-20 23:00+00', '2026-09-21 02:00+00',
        'aaaaaaaa-0000-0000-0000-000000000001'),
      ('c1c1c1c1-0000-0000-0000-000000000001', 'One-off B',
        '11111111-0000-0000-0000-000000000001',
        '2026-09-20 23:00+00', '2026-09-21 02:00+00',
        'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'two one-off events (series_id null, occurrence_date null) do not collide on the partial unique index'
);

-- ---------------------------------------------------------------------
-- Critical 1 (fix pass 1): deleting a series must not orphan the
-- occurrence-requires-series check. Occurrences survive as one-offs.
-- ---------------------------------------------------------------------
select lives_ok(
  $$delete from public.event_series
    where id = '55555555-0000-0000-0000-000000000001'$$,
  'a series with a materialized occurrence can be deleted'
);

select is(
  (select count(*)::int from public.events
   where id = 'e1e1e1e1-0000-0000-0000-000000000003'
     and series_id is null
     and occurrence_date is null
     and title = 'Materialized Tuesday'
     and starts_at = '2026-09-08 23:00+00'::timestamptz),
  1,
  'the occurrence survives its deleted series with series_id and occurrence_date cleared, title and starts_at intact'
);

-- ---------------------------------------------------------------------
-- The composite FK on event_tables holds on UPDATE, not only INSERT.
-- ---------------------------------------------------------------------
select throws_ok(
  $$update public.event_tables set club_id = 'c2c2c2c2-0000-0000-0000-000000000002'
    where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'
      and position = 1$$,
  '23503',
  null,
  'changing a table''s club_id alone breaks the composite foreign key'
);

select throws_ok(
  $$update public.events set club_id = 'c2c2c2c2-0000-0000-0000-000000000002'
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  '23503',
  null,
  'changing an event''s club_id while its tables still reference the old club is rejected'
);

-- ---------------------------------------------------------------------
-- A plain member can see a cancelled event -- the policy comment says so;
-- nothing tested it until now.
-- ---------------------------------------------------------------------
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, status, created_by)
values
  ('e1e1e1e1-0000-0000-0000-000000000004',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Cancelled game',
   '11111111-0000-0000-0000-000000000001',
   '2026-09-22 23:00+00', '2026-09-23 02:00+00', 'cancelled',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- A table on the still-draft event, to prove Important 2's fix from both
-- roles below.
insert into public.event_tables (event_id, club_id, label, position) values
  ('e1e1e1e1-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Draft table', 1);

-- Alice was demoted to a plain member earlier in this file and stays that
-- way for this block.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.events
   where id = 'e1e1e1e1-0000-0000-0000-000000000004'),
  1,
  'a plain member can see a cancelled event'
);

-- ---------------------------------------------------------------------
-- Important 2 (fix pass 1): event_tables visibility now follows its
-- event's own RLS instead of duplicating the draft carve-out.
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int from public.event_tables
   where event_id = 'e1e1e1e1-0000-0000-0000-000000000002'),
  0,
  'a plain member sees no rows for a draft event''s tables'
);

select is(
  (select count(*)::int from public.event_tables
   where event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  1,
  'a plain member still sees rows for a published event''s tables'
);

-- Promote Alice back to organizer to check the other side of the fix.
set local role postgres;
update public.club_members set role = 'host'
  where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_tables
   where event_id in ('e1e1e1e1-0000-0000-0000-000000000001',
                       'e1e1e1e1-0000-0000-0000-000000000002')),
  2,
  'an organizer sees tables for both the draft and the published event'
);

-- ---------------------------------------------------------------------
-- Fix pass 2. A third club, built from scratch, because the club-cascade
-- assertions below destroy everything they touch and club 1 is entangled
-- with the fixtures above -- and because club 1 stewards the venue, whose
-- `added_by_club_id` is ON DELETE NO ACTION and would block the delete for
-- an unrelated reason. Lakeside borrows The Hall instead of adding one.
-- ---------------------------------------------------------------------
set local role postgres;

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c3c3c3c3-0000-0000-0000-000000000003', 'Lakeside', 'lakeside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c3c3c3c3-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host');

insert into public.event_series
  (id, club_id, title, venue_id, frequency, weekday, start_time, starts_on,
   created_by)
values
  ('55555555-0000-0000-0000-000000000002',
   'c3c3c3c3-0000-0000-0000-000000000003', 'Lakeside Thursday',
   '11111111-0000-0000-0000-000000000001', 'weekly', 4, '19:00',
   '2026-10-01', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, series_id, title, venue_id, starts_at, ends_at,
   occurrence_date, created_by)
values
  ('e1e1e1e1-0000-0000-0000-000000000005',
   'c3c3c3c3-0000-0000-0000-000000000003',
   '55555555-0000-0000-0000-000000000002',
   'Lakeside occurrence', '11111111-0000-0000-0000-000000000001',
   '2026-10-01 23:00+00', '2026-10-02 02:00+00', '2026-10-01',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables (event_id, club_id, label, position) values
  ('e1e1e1e1-0000-0000-0000-000000000005',
   'c3c3c3c3-0000-0000-0000-000000000003', 'Lakeside table', 1);

-- ---------------------------------------------------------------------
-- Important (fix pass 2): the events -> event_series edge is composite, so
-- an occurrence cannot point at another club's series. Deleting that series
-- would otherwise have rewritten the foreign club's row through a
-- `security definer` trigger.
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.events
      (club_id, series_id, title, venue_id, starts_at, ends_at,
       occurrence_date, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001',
      '55555555-0000-0000-0000-000000000002', 'Smuggled occurrence',
      '11111111-0000-0000-0000-000000000001',
      '2026-10-08 23:00+00', '2026-10-09 02:00+00', '2026-10-08',
      'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23503',
  null,
  'an occurrence cannot reference a series belonging to another club'
);

-- ---------------------------------------------------------------------
-- Minor (fix pass 1, untested until now): `overrides` must be a FLAT array.
-- The first assertion is what makes the second one mean anything -- a
-- two-dimensional array passes the containment half of the check, so only
-- the array_ndims half can be rejecting it.
-- ---------------------------------------------------------------------
select ok(
  array[array['title'], array['notes']]
    <@ array['title', 'venue_id', 'notes', 'starts_at'],
  'a two-dimensional overrides array satisfies the containment test on its own'
);

select throws_ok(
  $$insert into public.events (club_id, title, venue_id, starts_at, ends_at,
      overrides, created_by)
    values ('c3c3c3c3-0000-0000-0000-000000000003', 'Nested override',
      '11111111-0000-0000-0000-000000000001',
      '2026-10-08 23:00+00', '2026-10-09 02:00+00',
      array[array['title'], array['notes']],
      'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'a multi-dimensional overrides array is rejected by the shape rule'
);

-- ---------------------------------------------------------------------
-- Critical (fix pass 2): the hole the club-cascade regression fell through.
-- `delete from clubs` cascades to event_series first, firing the detach
-- trigger, whose UPDATE re-validated events_club_id_fkey against a clubs
-- row that was already gone. Nothing asserted this path, so 139 passing
-- tests said nothing about it.
-- ---------------------------------------------------------------------
select lives_ok(
  $$delete from public.clubs
    where id = 'c3c3c3c3-0000-0000-0000-000000000003'$$,
  'a club with a series, its occurrences and their tables can be deleted'
);

select is(
  (select count(*)::int from public.event_series
   where club_id = 'c3c3c3c3-0000-0000-0000-000000000003'),
  0,
  'deleting the club leaves no event_series rows behind'
);

select is(
  (select count(*)::int from public.events
   where club_id = 'c3c3c3c3-0000-0000-0000-000000000003'),
  0,
  'deleting the club leaves no events rows behind'
);

select is(
  (select count(*)::int from public.event_tables
   where club_id = 'c3c3c3c3-0000-0000-0000-000000000003'),
  0,
  'deleting the club leaves no event_tables rows behind'
);

select * from finish();
rollback;
