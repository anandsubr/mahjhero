begin;
set local search_path to extensions, public;

select plan(27);

-- ------------------------------------------------------------------
-- Fixture. check_ins grants authenticated only SELECT, so every direct
-- read of the table below happens under `reset role;` — the pattern
-- need_a_fourth.test.sql established for notification_outbox.
-- ------------------------------------------------------------------
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'host@example.com'),
  ('10000000-0000-0000-0000-000000000002', 'ann@example.com'),
  ('10000000-0000-0000-0000-000000000003', 'bob@example.com'),
  ('10000000-0000-0000-0000-000000000004', 'walk@example.com'),
  ('10000000-0000-0000-0000-000000000005', 'eve@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('20000000-0000-0000-0000-000000000001', 'Door Club', 'door-club',
          'America/New_York', '10000000-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 'host', 'active'),
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000003', 'member', 'active'),
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000004', 'member', 'active')
  on conflict do nothing;

insert into public.venues (id, added_by_club_id, name, created_by)
  values ('30000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001', 'The Hall',
          '10000000-0000-0000-0000-000000000001');

-- The game is IN PROGRESS: started an hour ago, ends in two. This is the
-- state every door assertion below cares about, and the state in which
-- plan 4 refuses every booking mutation.
insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           check_in_required, created_by)
values ('40000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001', 'Tonight',
        '30000000-0000-0000-0000-000000000001',
        now() - interval '1 hour', now() + interval '2 hours',
        true, '10000000-0000-0000-0000-000000000001'),
       ('40000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000001', 'No Check-In',
        '30000000-0000-0000-0000-000000000001',
        now() - interval '1 hour', now() + interval '2 hours',
        false, '10000000-0000-0000-0000-000000000001');

insert into public.event_tables (id, event_id, club_id, label, position)
  values ('50000000-0000-0000-0000-000000000001',
          '40000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001', 'Table 1', 1);

insert into public.booking_groups (id, event_id, club_id, created_by)
  values ('60000000-0000-0000-0000-000000000001',
          '40000000-0000-0000-0000-000000000001',
          '20000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000002');

insert into public.bookings (group_id, event_id, club_id, event_table_id,
                             profile_id, booked_by, status) values
  ('60000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000002', 'confirmed'),
  ('60000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000002', 'confirmed');

-- ------------------------------------------------------------------
-- Tenancy. This is the first guard and it must fail before anything
-- about the event is revealed.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002', 'arrived')$$,
  '42501',
  null,
  'a non-member holding the event uuid is refused');

select throws_ok(
  $$select public.clear_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'clear_attendance runs the same tenancy guard');

-- ------------------------------------------------------------------
-- The organizer path.
-- ------------------------------------------------------------------
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002', 'arrived')$$,
  'an organizer marks a booked member arrived');

reset role;
select is(
  (select state::text from public.check_ins
    where event_id = '40000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000002'),
  'arrived',
  'the row says arrived');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Idempotency: the same write twice is one row, not two.
select lives_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002', 'arrived')$$,
  'a replayed write is accepted');

reset role;
select is(
  (select count(*)::int from public.check_ins
    where event_id = '40000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000002'),
  1,
  'a replayed write leaves exactly one row');

-- Staleness: an older occurred_at must not clobber a newer decision.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002', 'no_show',
      now() - interval '10 minutes')$$,
  'a stale write is accepted without error');

reset role;
select is(
  (select state::text from public.check_ins
    where event_id = '40000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000002'),
  'arrived',
  'a stale write does NOT overwrite the newer state');

-- The walk-in path: an organizer may record someone with no booking.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000004', 'arrived')$$,
  'an organizer records a walk-in with no booking');

reset role;
select is(
  (select state::text from public.check_ins
    where event_id = '40000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000004'),
  'arrived',
  'the walk-in''s row was actually written, not just accepted without error');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- But not somebody outside the club.
select throws_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000005', 'arrived')$$,
  '23514',
  'that person is not a member of this club',
  'a non-member cannot be recorded as a walk-in');

-- clear returns them to "not determined".
select lives_ok(
  $$select public.clear_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000004')$$,
  'an organizer clears a row');

reset role;
select is(
  (select count(*)::int from public.check_ins
    where event_id = '40000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000004'),
  0,
  'clearing removes the row rather than storing a third state');

-- ------------------------------------------------------------------
-- The member path.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003', 'arrived')$$,
  'a booked member checks themselves in');

reset role;
select is(
  (select state::text from public.check_ins
    where event_id = '40000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000003'),
  'arrived',
  'Bob''s self check-in was actually written, not just accepted without error');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002', 'no_show')$$,
  '42501',
  null,
  'a member cannot record somebody else');

-- clear_attendance runs the same role split as record_attendance: a member
-- may only ever clear their own row.
select throws_ok(
  $$select public.clear_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'a member cannot clear somebody else''s check-in');

-- A roster member with no confirmed booking has no self check-in right.
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000004', 'arrived')$$,
  '23514',
  'you do not have a seat at this game',
  'a member without a confirmed booking cannot self check in');

-- ------------------------------------------------------------------
-- The critical bug: an unvalidated occurred_at lets a member permanently
-- veto every future organizer correction by claiming 'infinity'. The
-- review's worked example is two live calls -- member claims infinity,
-- organizer corrects moments later -- but Postgres freezes now() for the
-- entire length of this file's transaction, so an organizer call issued
-- "moments later" in this same script sees an IDENTICAL now() to the
-- member's already-clamped claim and can never satisfy the upsert's
-- strict `>` newest-wins comparison. That tie is there with or without the
-- fix, so asserting on the resulting `state` cannot tell fixed from
-- unfixed inside one transaction (confirmed: it was tried and failed
-- red under the correct, fixed code too).
--
-- What the fix actually changes, and what DOES differ observably here, is
-- what gets written to recorded_at. Unclamped, an infinity claim is
-- stored as literal infinity: a ceiling no future write, in this
-- transaction or any other, separated by a second or a decade, can ever
-- exceed. Clamped, it is bounded to the instant of the call -- which is
-- exactly what makes it beatable by a real later write outside this
-- transaction. Mutation-checked: delete `least(..., now())` from
-- record_attendance's insert and this assertion goes red, because
-- recorded_at is then stored as literal infinity.
-- ------------------------------------------------------------------
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003', 'arrived',
      'infinity'::timestamptz)$$,
  'a member''s claimed occurred_at of infinity is accepted, not rejected');

reset role;
select is(
  (select recorded_at from public.check_ins
    where event_id = '40000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000003'),
  now(),
  'the clamp bounds a claimed occurred_at of infinity to exactly the present -- not merely to some future date -- so no future organizer correction can be permanently vetoed');

-- ------------------------------------------------------------------
-- The clamp must be one-sided: only a future occurred_at is pulled back to
-- now(); a past occurred_at is stored exactly as given, because a deferred
-- offline plan replays writes stamped at the moment the host actually
-- tapped. This needs a FRESH insert -- no upsert conflict, so no staleness
-- rung involved -- to pin, unlike the assertion above. The walk-in member
-- (profile 4) currently has no check_ins row for this event: their earlier
-- walk-in was cleared, and their later self check-in attempt threw before
-- writing anything. Mutation-checked: a two-sided clamp such as
-- greatest(least(occurred_at, now()), now()) leaves every other assertion
-- in this file green, so without this one the property the offline design
-- depends on is unguarded.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$ begin
  perform public.record_attendance(
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004', 'arrived',
    now() - interval '10 minutes');
end $$;

reset role;
select is(
  (select recorded_at from public.check_ins
    where event_id = '40000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000004'),
  now() - interval '10 minutes',
  'a past occurred_at is stored exactly as given, not clamped forward to the present');

-- ------------------------------------------------------------------
-- The flag, and the windows.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002', 'arrived')$$,
  '23514',
  'check-in is not enabled for this event',
  'an event that did not ask for check-in refuses every write');

reset role;
-- Push the game far into the future: before the window opens, nobody writes.
update public.events
   set starts_at = now() + interval '5 hours',
       ends_at   = now() + interval '8 hours'
 where id = '40000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003', 'arrived')$$,
  '23514',
  'check-in is not open for this event',
  'an organizer cannot write before the window opens');

-- Now put it two days in the past: the organizer tail has closed.
reset role;
update public.events
   set starts_at = now() - interval '2 days',
       ends_at   = now() - interval '2 days' + interval '3 hours'
 where id = '40000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003', 'arrived')$$,
  '23514',
  'check-in is not open for this event',
  'the organizer tail closes 24 hours after the game ends');

-- The asymmetry itself: a member's window closes at ends_at, while an
-- organizer's stays open for 24 more hours. Move the game to just past its
-- own end -- past the member's window, comfortably inside the organizer's
-- -- and confirm the member is refused there specifically. Mutation-checked:
-- widening the member branch to match the organizer's leaves every other
-- assertion in this file green, so without this one the asymmetry would be
-- unpinned.
reset role;
update public.events
   set starts_at = now() - interval '4 hours',
       ends_at   = now() - interval '30 minutes'
 where id = '40000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003', 'arrived')$$,
  '23514',
  'check-in is not open for this event',
  'a member''s window closes at ends_at, well inside the organizer''s 24-hour tail');

-- clear_attendance runs the same window guard: outside the member's own
-- window but still inside the organizer's 24-hour tail, a member clearing
-- their own row is refused too, not silently allowed through.
select throws_ok(
  $$select public.clear_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003')$$,
  '23514',
  'check-in is not open for this event',
  'a member cannot clear their own row once their window has closed, even though the organizer''s tail is still open');

-- ------------------------------------------------------------------
-- The status guard has never been exercised: no assertion above ever sets
-- events.status, so deleting the `ev.status <> 'published'` rung would
-- leave every assertion above green. Cancel the event and confirm even the
-- organizer is refused.
-- ------------------------------------------------------------------
reset role;
update public.events
   set status = 'cancelled'
 where id = '40000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002', 'arrived')$$,
  '23514',
  'event not open for check-in',
  'a cancelled event refuses every check-in write, even for the organizer');

select * from finish();
rollback;
