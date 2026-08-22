begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(53);

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

-- The other side of the same guard. A refusal test alone cannot tell a
-- working guard from one that refuses everything it does not own: `public`
-- has to be shown to still mean public.
select lives_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Away game',
      '11111111-0000-0000-0000-000000000003', '',
      '2027-09-14 23:00+00', '2027-09-15 02:00+00', 1)$$,
  'an organizer can book another club''s public venue'
);

-- An archived venue is nobody's, its own club's included.
select throws_ok(
  $$select public.create_event(
      'c1c1c1c1-0000-0000-0000-000000000001', 'In the old hall',
      '11111111-0000-0000-0000-000000000004', '',
      '2027-09-14 23:00+00', '2027-09-15 02:00+00', 1)$$,
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

-- A whitespace-padded but otherwise unchanged title is not a real change,
-- and must not register a false override — the column is always stored
-- trimmed, and the comparison has to match that.
select lives_ok(
  $$select public.update_event(
      'e1e1e1e1-0000-0000-0000-000000000001', '  Weekly game  ',
      null, null, null, null)$$,
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
    'Weekly game, this week only', null, null, null, null);
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
    null, null, 'bring your own tiles', null, null);
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
    null, null, null, '2027-09-07 22:30+00', null);
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
    null, null, null, null, '2027-09-15 03:00+00');
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
      '11111111-0000-0000-0000-000000000009', null, null, null)$$,
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
      'Away game, retitled', null, null, null, null)$$,
  'a title-only edit survives the venue being flipped to club-only'
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
      '2027-10-05 23:00+00', '2027-10-06 02:00+00', 20)$$,
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
      '2027-10-12 23:00+00', '2027-10-13 02:00+00', 1)$$,
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
      null, null, null, null)$$,
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
      null, null, null, null)$$,
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

select * from finish();
rollback;
