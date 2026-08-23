begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(81);

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

-- Oakfield's PUBLIC venue, and one of Riverside's own that has been
-- archived. The guard has three clauses and only one of them was asserted:
-- rewriting `v.visibility = 'public'` to `false`, or deleting
-- `and v.archived_at is null`, left every assertion in this file green.
insert into public.venues
  (id, name, added_by_club_id, visibility, archived_at, created_by) values
  ('11111111-0000-0000-0000-000000000003', 'The Civic Centre',
   'c2c2c2c2-0000-0000-0000-000000000002', 'public', null,
   'bbbbbbbb-0000-0000-0000-000000000002'),
  ('11111111-0000-0000-0000-000000000004', 'The old hall',
   'c1c1c1c1-0000-0000-0000-000000000001', 'club', now(),
   'aaaaaaaa-0000-0000-0000-000000000001');

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
      '2027-09-07', '19:00', 180, 3)$$,
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
      '2027-09-07', '19:00', 180, 1)$$,
  '42501',
  null,
  'an organizer cannot attach another club''s private venue'
);

-- The other side of the same guard. A refusal test alone cannot tell a
-- working guard from one that refuses everything it does not own: `public`
-- has to be shown to still mean public.
select lives_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Away game',
      '11111111-0000-0000-0000-000000000003', '',
      '2027-09-14', '19:00', 180, 1)$$,
  'an organizer can book another club''s public venue'
);

-- An archived venue is nobody's, its own club's included.
select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'In the old hall',
      '11111111-0000-0000-0000-000000000004', '',
      '2027-09-14', '19:00', 180, 1)$$,
  '42501',
  null,
  'an organizer cannot book their own club''s archived venue'
);

-- The role guard.
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Member''s event',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-09-07', '19:00', 180, 1)$$,
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
      '2027-09-07', '19:00', 180, 1)$$,
  '42501',
  null,
  'a host of another club cannot create an event here'
);

-- ---------------------------------------------------------------------
-- The instant itself, computed in Postgres from a club-local calendar date
-- and a wall-clock time (20260823070000). Riverside is America/New_York.
--
-- Nothing above pins a single stored timestamp: every creation assertion is
-- a lives_ok or a throws_ok, so `at time zone club_tz` could be dropped from
-- create_event entirely -- storing the naive local timestamp as though it
-- were UTC -- and this file would stay green. That is the shape of the bug
-- this migration exists to remove, so it gets assertions on both sides of
-- both 2027 US transitions: the same dates event_recurrence.test.sql
-- already pins for the series path, because both paths now run the same
-- expression.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select starts_at from public.events where title = 'Tuesday game'),
  timestamptz '2027-09-07 23:00+00',
  '19:00 on 2027-09-07 in an America/New_York club is 23:00Z (EDT, UTC-4)'
);

select is(
  (select ends_at from public.events where title = 'Tuesday game'),
  timestamptz '2027-09-08 02:00+00',
  'and 180 minutes of duration ends at 02:00Z the next day'
);

-- Setup, not claims: what is asserted is where each of these lands.
do $dst$
begin
  perform public.create_event(
    'c1c1c1c1-0000-0000-0000-000000000001', 'Night before spring forward',
    '11111111-0000-0000-0000-000000000001', '', '2027-03-13', '19:00', 180, 1);
  perform public.create_event(
    'c1c1c1c1-0000-0000-0000-000000000001', 'Spring forward night',
    '11111111-0000-0000-0000-000000000001', '', '2027-03-14', '19:00', 180, 1);
  perform public.create_event(
    'c1c1c1c1-0000-0000-0000-000000000001', 'Night before fall back',
    '11111111-0000-0000-0000-000000000001', '', '2027-11-06', '19:00', 180, 1);
  perform public.create_event(
    'c1c1c1c1-0000-0000-0000-000000000001', 'Fall back night',
    '11111111-0000-0000-0000-000000000001', '', '2027-11-07', '19:00', 180, 1);
  perform public.create_event(
    'c1c1c1c1-0000-0000-0000-000000000001', 'Through the missing hour',
    '11111111-0000-0000-0000-000000000001', '', '2027-03-14', '01:00', 180, 1);
end
$dst$;

-- The pairs straddle a transition. An implementation that ignores DST gets
-- one of each pair right and the other wrong by exactly an hour, so neither
-- assertion of a pair can carry the other.
select is(
  (select starts_at from public.events where title = 'Night before spring forward'),
  timestamptz '2027-03-14 00:00+00',
  '19:00 the evening before spring forward is EST, UTC-5'
);

select is(
  (select starts_at from public.events where title = 'Spring forward night'),
  timestamptz '2027-03-14 23:00+00',
  '19:00 on spring-forward day itself is EDT, UTC-4'
);

select is(
  (select starts_at from public.events where title = 'Night before fall back'),
  timestamptz '2027-11-06 23:00+00',
  '19:00 the evening before fall back is still EDT, UTC-4'
);

select is(
  (select starts_at from public.events where title = 'Fall back night'),
  timestamptz '2027-11-08 00:00+00',
  '19:00 on fall-back day itself is EST, UTC-5'
);

-- Duration is elapsed time, not wall-clock difference: a three-hour game
-- starting at 01:00 on spring-forward morning ends at 05:00 on the clock,
-- because 02:00-03:00 never happens.
select is(
  (select starts_at from public.events where title = 'Through the missing hour'),
  timestamptz '2027-03-14 06:00+00',
  'a game starting before the missing hour starts at EST'
);

select is(
  (select to_char(ends_at at time zone 'America/New_York', 'HH24:MI')
   from public.events where title = 'Through the missing hour'),
  '05:00',
  'and three hours later reads 05:00, because 02:00-03:00 did not happen'
);

-- The calendar arguments are required, and a duration has to be plausible.
-- Both defaults are non-null in the signature, so only an explicit null or
-- an out-of-range int can reach these.
select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'No date',
      '11111111-0000-0000-0000-000000000001', '',
      null, '19:00', 180, 1)$$,
  '23514',
  null,
  'an event must have a date'
);

select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Too short',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-09-07', '19:00', 5, 1)$$,
  '23514',
  null,
  'a five-minute game is refused, matching event_series.duration_minutes'
);

select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Too long',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-09-07', '19:00', 2000, 1)$$,
  '23514',
  null,
  'and a game longer than a day is refused too'
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
), (
  -- A second, untouched occurrence of the same series. The `starts_at`
  -- override key guards BOTH instants, and that can only be shown on a row
  -- whose overrides do not already carry it.
  'e1e1e1e1-0000-0000-0000-000000000002',
  'c1c1c1c1-0000-0000-0000-000000000001',
  '55555555-0000-0000-0000-000000000001', 'Weekly game',
  '11111111-0000-0000-0000-000000000001',
  '2027-09-14 23:00+00', '2027-09-15 02:00+00', '2027-09-14',
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
      '11111111-0000-0000-0000-000000000002', null, null, null, null)$$,
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
      '11111111-0000-0000-0000-000000000001', null, null, null, null)$$,
  'the venue can be changed again'
);

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  $$values (array['venue_id'])$$,
  'the override list does not accumulate duplicates'
);

-- A whitespace-padded but otherwise unchanged title is not a real change,
-- and must not register a false override — the column is always stored
-- trimmed, and the comparison has to match that.
select lives_ok(
  $$select public.update_event(
      'e1e1e1e1-0000-0000-0000-000000000001', '  Weekly game  ',
      null, null, null, null, null)$$,
  'a whitespace-padded but otherwise unchanged title is accepted'
);

select is(
  (select title from public.events
   where id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  'Weekly game',
  'the title is stored trimmed and unchanged'
);

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  $$values (array['venue_id'])$$,
  'a whitespace-only title does not register a false override'
);

-- ---------------------------------------------------------------------
-- The remaining three override keys. Every assertion above turns on
-- venue_id alone, so deleting the title, notes or starts_at branch of the
-- comparison outright left this whole file green.
--
-- The edits themselves are setup, not claims: what is being asserted is
-- which keys each one records.
-- ---------------------------------------------------------------------
do $edit$
begin
  perform public.update_event(
    'e1e1e1e1-0000-0000-0000-000000000001',
    'Weekly game, this week only', null, null, null, null, null);
end
$edit$;

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  $$values (array['title', 'venue_id'])$$,
  'a title that really did change records the title override'
);

do $edit$
begin
  perform public.update_event(
    'e1e1e1e1-0000-0000-0000-000000000001',
    null, null, 'bring your own tiles', null, null, null);
end
$edit$;

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  $$values (array['notes', 'title', 'venue_id'])$$,
  'a notes change records the notes override'
);

do $edit$
begin
  perform public.update_event(
    'e1e1e1e1-0000-0000-0000-000000000001',
    null, null, null, null, '18:30', null);
end
$edit$;

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'$$,
  $$values (array['notes', 'starts_at', 'title', 'venue_id'])$$,
  'moving the start records the starts_at override'
);

-- The same edit passed null for notes. "Leave this alone" is the whole
-- contract of a null argument, and a coalesce to '' instead of to the
-- stored value would have cleared them here without any other assertion
-- noticing.
select is(
  (select notes from public.events
   where id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  'bring your own tiles',
  'and its null notes argument left the notes alone rather than clearing them'
);

-- `starts_at` guards both instants deliberately: a hand-set 6:30-9:30 week
-- must not keep its start and silently take the series' new length. On the
-- untouched second occurrence, so the key cannot already be there.
do $edit$
begin
  perform public.update_event(
    'e1e1e1e1-0000-0000-0000-000000000002',
    null, null, null, null, null, 240);
end
$edit$;

select results_eq(
  $$select overrides from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000002'$$,
  $$values (array['starts_at'])$$,
  'moving only the end still records the starts_at override'
);

-- ---------------------------------------------------------------------
-- The venue guard on the UPDATE path, which had no assertion at all:
-- deleting `perform assert_venue_available` from update_event left this
-- file green.
-- ---------------------------------------------------------------------
select throws_ok(
  $$select public.update_event(
      'e1e1e1e1-0000-0000-0000-000000000002', null,
      '11111111-0000-0000-0000-000000000009', null, null, null, null)$$,
  '42501',
  null,
  'an organizer cannot move an occurrence to another club''s private venue'
);

-- And the reason that guard is CONDITIONAL. A venue that was public when an
-- event booked it can be flipped to club-only afterwards by its owning club;
-- re-asserting on every edit would leave the borrowing club unable to edit
-- its own event, over a change it neither made nor can undo.
set local role postgres;
update public.venues set visibility = 'club'
  where id = '11111111-0000-0000-0000-000000000003';
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event(
      (select id from public.events where title = 'Away game'),
      'Away game, retitled', null, null, null, null, null)$$,
  'a title-only edit survives the venue being flipped to club-only'
);

-- A one-off event records no overrides — it has no series to diverge from.
select lives_ok(
  $$select public.update_event(
      (select id from public.events where title = 'Tuesday game'),
      'Tuesday game, moved', null, null, null, null, null)$$,
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
      null, null, null, null, null)$$,
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

-- ---------------------------------------------------------------------
-- Minor 1: the cap is on table count, not on the highest position ever
-- issued. An event that briefly held twenty tables and then lost one to a
-- removal must still be able to add one back, even though positions stay
-- sparse.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Full house',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-10-05', '19:00', 180, 20)$$,
  'an organizer can create an event with the maximum number of tables'
);

select lives_ok(
  $$select public.remove_event_table(
      (select t.id from public.event_tables t
       join public.events e on e.id = t.event_id
       where e.title = 'Full house' and t.position = 1))$$,
  'a table can be removed from a full event'
);

select lives_ok(
  $$select public.add_event_table(
      (select id from public.events where title = 'Full house'))$$,
  'a table can be added back after a removal, even though positions stayed sparse'
);

select is(
  (select count(*)::int from public.event_tables t
   join public.events e on e.id = t.event_id
   where e.title = 'Full house'),
  20,
  'the event holds twenty tables again, capped on count rather than on position'
);

-- The cap is still a cap. Nothing above ever asked for a twenty-first
-- table, so `live_count >= 20` could be loosened to `>= 21` and stay green.
select throws_ok(
  $$select public.add_event_table(
      (select id from public.events where title = 'Full house'))$$,
  '23514',
  null,
  'a twenty-first table is refused'
);

-- ---------------------------------------------------------------------
-- Minor 4: a cancelled event's seating is frozen exactly like its details.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Called off',
      '11111111-0000-0000-0000-000000000001', '',
      '2027-10-12', '19:00', 180, 1)$$,
  'setup: an event to cancel'
);

select lives_ok(
  $$select public.cancel_event(
      (select id from public.events where title = 'Called off'))$$,
  'setup: the event is cancelled'
);

select throws_ok(
  $$select public.add_event_table(
      (select id from public.events where title = 'Called off'))$$,
  '42501',
  null,
  'a cancelled event cannot have a table added'
);

select throws_ok(
  $$select public.update_event_table(
      (select t.id from public.event_tables t
       join public.events e on e.id = t.event_id
       where e.title = 'Called off'),
      'Renamed', null)$$,
  '42501',
  null,
  'a cancelled event''s table cannot be relabelled'
);

select throws_ok(
  $$select public.remove_event_table(
      (select t.id from public.event_tables t
       join public.events e on e.id = t.event_id
       where e.title = 'Called off'))$$,
  '42501',
  null,
  'a cancelled event cannot have a table removed'
);

-- ---------------------------------------------------------------------
-- The organizer guard, on every function, against the ROW's own club.
--
-- create_event's guard was the only one with an assertion behind it.
-- Deleting `perform public.assert_club_organizer(...)` from any of the other
-- five left this file green, and so did replacing it with the plan-2-shaped
-- "does the caller organize ANYTHING" check that passing a club-scoped
-- argument exists to prevent.
--
-- Two callers per function, because they fail for different reasons and each
-- catches a different mutation. Carol is an ordinary member of the owning
-- club: she catches a guard that is gone. Bob is a host of a DIFFERENT club:
-- he catches a guard that asks the question without the club.
-- ---------------------------------------------------------------------
set local role postgres;

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, created_by
) values (
  'e2e2e2e2-0000-0000-0000-000000000001',
  'c1c1c1c1-0000-0000-0000-000000000001', 'Guarded',
  '11111111-0000-0000-0000-000000000001',
  '2027-11-02 23:00+00', '2027-11-03 02:00+00',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('7a7a7a7a-0000-0000-0000-000000000001',
   'e2e2e2e2-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 1),
  ('7a7a7a7a-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 2);

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.update_event(
      'e2e2e2e2-0000-0000-0000-000000000001', 'Member''s edit',
      null, null, null, null, null)$$,
  '42501', null,
  'a plain member cannot edit an event'
);

select throws_ok(
  $$select public.cancel_event('e2e2e2e2-0000-0000-0000-000000000001')$$,
  '42501', null,
  'a plain member cannot cancel an event'
);

select throws_ok(
  $$select public.add_event_table('e2e2e2e2-0000-0000-0000-000000000001')$$,
  '42501', null,
  'a plain member cannot add a table'
);

select throws_ok(
  $$select public.update_event_table(
      '7a7a7a7a-0000-0000-0000-000000000001', 'Member''s table', null)$$,
  '42501', null,
  'a plain member cannot relabel a table'
);

select throws_ok(
  $$select public.remove_event_table(
      '7a7a7a7a-0000-0000-0000-000000000001')$$,
  '42501', null,
  'a plain member cannot remove a table'
);

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$select public.update_event(
      'e2e2e2e2-0000-0000-0000-000000000001', 'Bob''s edit',
      null, null, null, null, null)$$,
  '42501', null,
  'a host of another club cannot edit this club''s event'
);

select throws_ok(
  $$select public.cancel_event('e2e2e2e2-0000-0000-0000-000000000001')$$,
  '42501', null,
  'a host of another club cannot cancel this club''s event'
);

select throws_ok(
  $$select public.add_event_table('e2e2e2e2-0000-0000-0000-000000000001')$$,
  '42501', null,
  'a host of another club cannot add a table here'
);

select throws_ok(
  $$select public.update_event_table(
      '7a7a7a7a-0000-0000-0000-000000000001', 'Bob''s table', null)$$,
  '42501', null,
  'a host of another club cannot relabel a table here'
);

select throws_ok(
  $$select public.remove_event_table(
      '7a7a7a7a-0000-0000-0000-000000000001')$$,
  '42501', null,
  'a host of another club cannot remove a table here'
);

-- ---------------------------------------------------------------------
-- The organizer guard again, now pinned to an ARGUMENT SHAPE rather than to
-- being present at all. update_event's guard sits ahead of every other
-- check in the function, but every assertion above calls it with a
-- non-null new_title -- so `if new_title is not null then perform
-- assert_club_organizer(...); end if;` passes every assertion in this file
-- while leaving a title-less edit (a date move, a notes-only edit) wide
-- open to any member. Two shapes below, both with new_title => null, and
-- chosen to also cross update_event's own branch between "nothing
-- calendar-shaped changed" and "recompute the instant" -- neither call can
-- carry the other.
--
-- create_event's guard is the first statement in the function, but both
-- assertions above call it with every optional argument filled in, so a
-- guard conditioned on any one of them -- event_notes, event_date,
-- start_time, duration_minutes, table_count -- is equally invisible. One
-- call below, with all five explicit null, closes every one of them at
-- once: skip the guard for any of them and the function still raises, but
-- 23514 ("an event must have a date") rather than 42501, and throws_ok
-- tells the two apart.
--
-- update_event_table has the identical shape: every assertion above calls
-- it with a non-null new_label and a null new_tier, so `if new_label is
-- not null then ...` passes unnoticed. new_tier is already null in every
-- existing call, so the other half of this guard is already covered --
-- only a shape where new_label, not new_tier, is the null one is missing.
--
-- cancel_event, add_event_table and remove_event_table take exactly one
-- required argument each. There is no second shape to pin the guard to:
-- the argument that reaches the guard is the same one that resolves the
-- row, so this class of mutation does not apply to them.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.update_event(
      target_event => 'e2e2e2e2-0000-0000-0000-000000000001',
      new_title    => null,
      new_notes    => 'Member''s notes')$$,
  '42501', null,
  'a plain member cannot edit an event by notes alone, title left null'
);

select throws_ok(
  $$select public.update_event(
      target_event   => 'e2e2e2e2-0000-0000-0000-000000000001',
      new_title      => null,
      new_date       => '2027-11-09',
      new_start_time => '20:00')$$,
  '42501', null,
  'a plain member cannot move an event''s date/time, title left null'
);

select throws_ok(
  $$select public.create_event(
      target_club       => 'c1c1c1c1-0000-0000-0000-000000000001',
      event_title       => 'Member''s all-defaults event',
      target_venue      => '11111111-0000-0000-0000-000000000001',
      event_notes       => null,
      event_date        => null,
      start_time        => null,
      duration_minutes  => null,
      table_count       => null)$$,
  '42501', null,
  'a plain member cannot create an event, every optional argument null'
);

select throws_ok(
  $$select public.update_event_table(
      target_table => '7a7a7a7a-0000-0000-0000-000000000001',
      new_label    => null,
      new_tier     => 'advanced')$$,
  '42501', null,
  'a plain member cannot relabel a table by tier alone, label left null'
);

-- ---------------------------------------------------------------------
-- An event keeps at least one table. Nothing above ever removed the last
-- one, so `remaining <= 1` could be loosened to `remaining <= 0` and stay
-- green — leaving an event with nowhere to sit anybody.
-- ---------------------------------------------------------------------
set local role postgres;
delete from public.event_tables
  where id = '7a7a7a7a-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.remove_event_table(
      '7a7a7a7a-0000-0000-0000-000000000001')$$,
  '23514', null,
  'an event''s last table cannot be removed'
);

-- ---------------------------------------------------------------------
-- Moving an occurrence to a different DATE, which is the thing the edit
-- screen needs and the reason update_event takes calendar values too.
--
-- Both rows below are inserted directly, at instants chosen so that the two
-- failure modes are distinguishable from success.
-- ---------------------------------------------------------------------
set local role postgres;

insert into public.events (
  id, club_id, series_id, title, venue_id, starts_at, ends_at,
  occurrence_date, created_by
) values (
  -- 2027-03-13 19:00 America/New_York, i.e. EST.
  'e3e3e3e3-0000-0000-0000-000000000001',
  'c1c1c1c1-0000-0000-0000-000000000001',
  '55555555-0000-0000-0000-000000000001', 'Moving week',
  '11111111-0000-0000-0000-000000000001',
  '2027-03-14 00:00+00', '2027-03-14 03:00+00', '2027-03-13',
  'aaaaaaaa-0000-0000-0000-000000000001'
), (
  -- 01:30 on 2027-11-07 happens TWICE in America/New_York: 05:30Z while
  -- still EDT, and 06:30Z once EST resumes. This row is the first of the
  -- two, and `timestamp '2027-11-07 01:30' at time zone 'America/New_York'`
  -- resolves to the second (asserted in event_recurrence.test.sql). So an
  -- edit that round-tripped this instant through the club's zone instead of
  -- leaving it alone would move the game an hour later and record a false
  -- override, and both of those are visible below.
  'e3e3e3e3-0000-0000-0000-000000000002',
  'c1c1c1c1-0000-0000-0000-000000000001',
  '55555555-0000-0000-0000-000000000001', 'The repeated hour',
  '11111111-0000-0000-0000-000000000001',
  '2027-11-07 05:30+00', '2027-11-07 08:30+00', '2027-11-07',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event(
      'e3e3e3e3-0000-0000-0000-000000000001',
      null, null, null, '2027-03-14', null, null)$$,
  'an occurrence can be moved to a different date'
);

select is(
  (select starts_at from public.events
   where id = 'e3e3e3e3-0000-0000-0000-000000000001'),
  timestamptz '2027-03-14 23:00+00',
  'moving across a spring forward keeps the wall clock, not the instant'
);

select is(
  (select ends_at from public.events
   where id = 'e3e3e3e3-0000-0000-0000-000000000001'),
  timestamptz '2027-03-15 02:00+00',
  'and carries the duration it already had, in elapsed minutes'
);

select results_eq(
  $$select overrides from public.events
    where id = 'e3e3e3e3-0000-0000-0000-000000000001'$$,
  $$values (array['starts_at'])$$,
  'a date move records the starts_at override'
);

select throws_ok(
  $$select public.update_event(
      'e3e3e3e3-0000-0000-0000-000000000001',
      null, null, null, null, null, 5)$$,
  '23514',
  null,
  'an edit cannot set an implausible duration either'
);

-- An edit that names no date, no time and no duration must leave both
-- instants exactly as they are -- not recompute them from the club's zone.
-- Inside the repeated hour those two are not the same thing.
select lives_ok(
  $$select public.update_event(
      'e3e3e3e3-0000-0000-0000-000000000002', 'The repeated hour, retitled',
      null, null, null, null, null)$$,
  'a title-only edit of an occurrence inside the repeated hour is accepted'
);

select is(
  (select starts_at from public.events
   where id = 'e3e3e3e3-0000-0000-0000-000000000002'),
  timestamptz '2027-11-07 05:30+00',
  'and leaves its instant exactly where it was, ambiguity and all'
);

select results_eq(
  $$select overrides from public.events
    where id = 'e3e3e3e3-0000-0000-0000-000000000002'$$,
  $$values (array['title'])$$,
  'and records only the title, never a starts_at it did not change'
);

-- ---------------------------------------------------------------------
-- A game nobody could ever see must not save (20260824001000).
--
-- `fetchUpcomingEvents` filters `starts_at >= now()` and is the only events
-- listing the app has, so a past-dated game -- a mistyped year is enough --
-- used to return a uuid, redirect on success, and then exist nowhere a host
-- could find it.
-- ---------------------------------------------------------------------

select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Yesterday''s game',
      '11111111-0000-0000-0000-000000000001', '',
      (current_date - 1), '19:00', 180, 1)$$,
  '23514',
  'that start time has already passed',
  'a game dated before today is refused instead of saving somewhere invisible'
);

/*
 * The guard is against the INSTANT, not the calendar date, and this is the
 * assertion that says so -- built so that it cannot become an accident of
 * what time the suite happens to run at.
 *
 * A club in Asia/Tokyo, nine hours AHEAD of the server's UTC. Midnight on
 * `current_date` in Tokyo is 15:00 UTC on the day BEFORE, so that instant is
 * behind `now()` at every moment of every day -- while `event_date` is
 * `current_date` itself, not before it. A date-granularity check
 * (`event_date < current_date`) therefore accepts it and saves a game the
 * host can never see, which is the whole failure one day smaller; the
 * instant check refuses it. Written against a US-zone club instead, this
 * assertion is only sharp for twenty of every twenty-four hours, and a
 * mutation run in the other four would have called it green.
 */
set local role postgres;
insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c3c3c3c3-0000-0000-0000-000000000003', 'Shinjuku', 'shinjuku',
   'Asia/Tokyo', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.club_members (club_id, profile_id, role) values
  ('c3c3c3c3-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host');
insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000005', 'Kissaten',
   'c3c3c3c3-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select public.create_event(
      'c3c3c3c3-0000-0000-0000-000000000003', 'Midnight in Tokyo',
      '11111111-0000-0000-0000-000000000005', '',
      current_date, '00:00', 180, 1)$$,
  '23514',
  'that start time has already passed',
  'and so is one dated today whose start time has already gone by -- the check is on the instant, not the day'
);

-- The other side of the boundary, so a mutant that simply refuses everything
-- cannot pass. current_date + 1 at 19:00 New York is at least twenty hours
-- ahead of any `now()` this can run at.
select lives_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Tomorrow''s game',
      '11111111-0000-0000-0000-000000000001', '',
      (current_date + 1), '19:00', 180, 1)$$,
  'a game dated tomorrow is created as normal'
);

select throws_ok(
  $$select public.update_event(
      'e3e3e3e3-0000-0000-0000-000000000001',
      null, null, null, (current_date - 5), null, null)$$,
  '23514',
  'that start time has already passed',
  'and an edit cannot move a live game backwards into the past either'
);

-- ...but editing a game that is ALREADY in the past is not the same act and
-- stays allowed. The guard is conditioned on the instant actually changing
-- (`eff_starts is distinct from ev.starts_at`); dropping that half would
-- refuse every correction to every game that has already happened, which is
-- the mutant this assertion exists to kill.
set local role postgres;
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e4e4e4e4-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Last month''s game',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '30 days', now() - interval '30 days' + interval '3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event(
      'e4e4e4e4-0000-0000-0000-000000000001',
      'Last month''s game, corrected', null, null, null, null, null)$$,
  'a game that already happened can still have its name corrected'
);

select * from finish();
rollback;
