begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(20);

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

select * from finish();
rollback;
