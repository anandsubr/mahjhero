begin;
set local search_path to extensions, public;

select plan(22);

-- Fixture: one user, one club, one venue, one series.
insert into auth.users (id, email)
  values ('11111111-1111-1111-1111-111111111111', 'host@example.com');
update public.profiles set display_name = 'Host'
  where id = '11111111-1111-1111-1111-111111111111';

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('22222222-2222-2222-2222-222222222222', 'Test Club', 'test-club',
          'America/New_York', '11111111-1111-1111-1111-111111111111');

insert into public.club_members (club_id, profile_id, role, status)
  values ('22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111', 'host', 'active')
  on conflict do nothing;
insert into public.venues (id, added_by_club_id, name, created_by)
  values ('33333333-3333-3333-3333-333333333333',
          '22222222-2222-2222-2222-222222222222', 'The Hall',
          '11111111-1111-1111-1111-111111111111');

-- 1 & 2: the columns exist and default to false.
select has_column('public', 'events', 'check_in_required',
  'events.check_in_required exists');

insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  starts_on, check_in_required, created_by)
values ('44444444-4444-4444-4444-444444444444',
        '22222222-2222-2222-2222-222222222222', 'Tuesday Night',
        '33333333-3333-3333-3333-333333333333', 'weekly', 2, '19:00',
        current_date, true, '11111111-1111-1111-1111-111111111111');

select is(
  (select check_in_required from public.event_series
     where id = '44444444-4444-4444-4444-444444444444'),
  true,
  'event_series.check_in_required stores what it was given');

-- 3: materialization carries the flag onto every occurrence.
select ok(
  public.materialize_one_series(
    '44444444-4444-4444-4444-444444444444', 21) > 0,
  'the series materialized at least one occurrence');

select is(
  (select bool_and(check_in_required) from public.events
     where series_id = '44444444-4444-4444-4444-444444444444'),
  true,
  'every materialized occurrence inherits check_in_required');

-- 4: a one-off event defaults to false.
insert into public.events (club_id, title, venue_id, starts_at, ends_at,
                           created_by)
values ('22222222-2222-2222-2222-222222222222', 'One-off',
        '33333333-3333-3333-3333-333333333333',
        now() + interval '2 days', now() + interval '2 days 3 hours',
        '11111111-1111-1111-1111-111111111111');

select is(
  (select check_in_required from public.events where title = 'One-off'),
  false,
  'a one-off event defaults to check-in not required');

-- 5: the overrides constraint accepts the new key.
select lives_ok(
  $$update public.events
      set overrides = array['check_in_required']
      where title = 'One-off'$$,
  'check_in_required is a legal overrides key');

-- 6: create_event sets the flag.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Setup, not claims: what is asserted is what check_in_required lands as.
-- A `create_event(...)` call cannot sit inside the `is()` expression itself
-- (as the brief's own snippet does): the WHERE clause `id = create_event(...)`
-- has no correlation to the `events` scan, so the planner is free to
-- re-evaluate the volatile call once per row already in the table instead of
-- once total, each call inserting its own row -- and, empirically against a
-- club with a few dozen already-materialized occurrences, that is exactly
-- what happens: every call creates that many duplicate rows, `id = <the last
-- call's uuid>` matches none of them, and the reads below come back NULL
-- while `update_event`'s later subquery finds more than one 'Quiet Night'
-- and errors. Following the do-block-perform idiom already used earlier in
-- this file (20260823070000's DST block, event_mutations.test.sql) makes the
-- call its own top-level command, so it runs exactly once.
do $$
begin
  perform public.create_event(
    '22222222-2222-2222-2222-222222222222', 'Door Night',
    '33333333-3333-3333-3333-333333333333', '',
    (current_date + 3), '19:00', 180, 2, true);
end
$$;

select is(
  (select check_in_required from public.events where title = 'Door Night'),
  true,
  'create_event stores check_in_required');

-- 7: it defaults to false when the caller says nothing.
do $$
begin
  perform public.create_event(
    '22222222-2222-2222-2222-222222222222', 'Quiet Night',
    '33333333-3333-3333-3333-333333333333', '',
    (current_date + 4), '19:00', 180, 2);
end
$$;

select is(
  (select check_in_required from public.events where title = 'Quiet Night'),
  false,
  'create_event defaults check_in_required to false');

-- 8: update_event flips it and records the override.
--
-- DEVIATION FROM BRIEF: the brief's snippet runs this against 'Quiet Night',
-- the standalone one-off from test 7. But the override-recording block this
-- migration adds to (following the brief's own instruction to place it
-- alongside "its sibling override blocks") lives inside the function's
-- existing `if ev.series_id is not null then ... end if;` guard, matching
-- the idiom the title/venue/notes/starts_at fields already use -- overrides
-- exist to stop SERIES propagation from clobbering a hand-edited occurrence,
-- so a standalone event (series_id null) never touches that array, whatever
-- field is edited. Run as written against 'Quiet Night' this assertion can
-- never pass. Targeted instead at the earliest materialized 'Tuesday Night'
-- occurrence from test 3 (series-linked, check_in_required inherited as
-- true), flipping it to false so both halves of the assertion -- the stored
-- value and the override entry -- are exercised the same way the other four
-- fields are tested elsewhere in this suite.
select lives_ok(
  $$select public.update_event(
      (select id from public.events
         where series_id = '44444444-4444-4444-4444-444444444444'
         order by occurrence_date limit 1),
      null, null, null, null, null, null, false)$$,
  'update_event accepts check_in_required');

select ok(
  (select not check_in_required
     and 'check_in_required' = any(overrides)
   from public.events
   where series_id = '44444444-4444-4444-4444-444444444444'
   order by occurrence_date limit 1),
  'update_event sets the flag and records the override');

-- ---------------------------------------------------------------------
-- 11-22: create_event_series and update_event_series, neither of which had
-- any coverage before -- only their sibling one-off functions (tests 6-10
-- above) were asserted. `starts_on` is deliberately (current_date + 1),
-- never current_date: materialize_one_series floors its window at
-- current_date, and a series starting today can land its first occurrence
-- earlier in the day than `now()` depending on what time this suite runs,
-- which would make every `starts_at > now()` propagation check below flaky.
-- ---------------------------------------------------------------------
-- Positional, not named: named notation on this function fails to resolve
-- here (42883, "does not exist") because the bare integer literal `5` for
-- `weekday` is int4, and int4 -> smallint is only an assignment cast, not an
-- implicit one -- the mismatch is invisible in a normal call (Postgres
-- narrows it against the one candidate by position) but poisons the whole
-- overload search once named notation is skipping other defaulted params.
-- `5::smallint` sidesteps it either way; kept positional to match this
-- function's only other call site (create_event_series is not otherwise
-- exercised, but this mirrors create_event's and update_event's calls
-- throughout this file).
select lives_ok(
  $$select public.create_event_series(
      '22222222-2222-2222-2222-222222222222',
      'Friday Night',
      '33333333-3333-3333-3333-333333333333',
      '',
      'weekly',
      5::smallint,
      null,
      '19:00',
      180,
      1,
      (current_date + 1),
      null,
      true)$$,
  'an organizer can create a series with check-in required'
);

select is(
  (select check_in_required from public.event_series
     where title = 'Friday Night'),
  true,
  'create_event_series stores check_in_required on the series');

select ok(
  (select count(*) from public.events e
     join public.event_series s on s.id = e.series_id
     where s.title = 'Friday Night') > 0,
  'create_event_series materialized at least one occurrence');

select is(
  (select bool_and(e.check_in_required) from public.events e
     join public.event_series s on s.id = e.series_id
     where s.title = 'Friday Night'),
  true,
  'and every materialized occurrence inherits check_in_required');

-- Override the earliest occurrence's check_in_required, the same way test 8
-- did for the other series -- this is the row that a later series-level
-- edit must leave alone.
select lives_ok(
  $$select public.update_event(
      (select e.id from public.events e
         join public.event_series s on s.id = e.series_id
         where s.title = 'Friday Night'
         order by e.occurrence_date limit 1),
      null, null, null, null, null, null, false)$$,
  'an organizer can override check_in_required on one occurrence'
);

select ok(
  (select not e.check_in_required
     and 'check_in_required' = any(e.overrides)
   from public.events e
   join public.event_series s on s.id = e.series_id
   where s.title = 'Friday Night'
   order by e.occurrence_date limit 1),
  'the override is recorded on that occurrence, not the series');

-- First flip: true -> false. Propagates to the future occurrence that did
-- NOT override the field.
select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series where title = 'Friday Night'),
      null, null, null, null, null, null, null, false, false, false)$$,
  'an organizer can flip check_in_required on the series'
);

select is(
  (select check_in_required from public.event_series
     where title = 'Friday Night'),
  false,
  'update_event_series stores the new value on the series');

select is(
  (select e.check_in_required from public.events e
     join public.event_series s on s.id = e.series_id
     where s.title = 'Friday Night'
       and not ('check_in_required' = any(e.overrides))
     order by e.occurrence_date limit 1),
  false,
  'and propagates the flip to a future occurrence that has not overridden it');

-- Second flip: false -> true. The discriminating case -- both the propagated
-- occurrence and the overridden one start this step at `false`, so only a
-- working override guard tells them apart afterward.
select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series where title = 'Friday Night'),
      null, null, null, null, null, null, null, false, false, true)$$,
  'the series check_in_required can be flipped again'
);

select is(
  (select e.check_in_required from public.events e
     join public.event_series s on s.id = e.series_id
     where s.title = 'Friday Night'
       and not ('check_in_required' = any(e.overrides))
     order by e.occurrence_date limit 1),
  true,
  'the non-overridden occurrence follows the series to true'
);

select is(
  (select e.check_in_required from public.events e
     join public.event_series s on s.id = e.series_id
     where s.title = 'Friday Night'
       and 'check_in_required' = any(e.overrides)
     order by e.occurrence_date limit 1),
  false,
  'but the overridden occurrence keeps its own value, untouched by the series edit'
);

reset role;

select * from finish();
rollback;
