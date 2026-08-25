begin;
set local search_path to extensions, public;

select plan(10);

-- ------------------------------------------------------------------
-- Fixture. Identical to check_in.test.sql: same uuids, same in-progress
-- event. check_ins and notification_outbox grant authenticated no direct
-- reads, so every read below happens under `reset role;` -- the pattern
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
-- A member self-reports. The host is told.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

select lives_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000003', 'no_show')$$,
  'a member reports they cannot make it');

-- notification_outbox grants authenticated nothing, so read it as the
-- table owner. This is need_a_fourth.test.sql's pattern.
reset role;
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'attendance_declined'
      and event_id = '40000000-0000-0000-0000-000000000001'),
  1,
  'exactly one organizer is told');

select is(
  (select recipient_id from public.notification_outbox
    where kind = 'attendance_declined'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'the host is the recipient');

select is(
  (select payload->>'declined_by' from public.notification_outbox
    where kind = 'attendance_declined'),
  '10000000-0000-0000-0000-000000000003',
  'the payload names the member, under the key the renderer already reads');

-- Undo and redo does not tell them twice.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';
select public.clear_attendance(
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003');
select public.record_attendance(
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000003', 'no_show');

reset role;
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'attendance_declined'),
  1,
  'undo-and-redo does not tell the host twice');

-- A host marking the same member no_show tells nobody.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.record_attendance(
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002', 'no_show');

reset role;
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'attendance_declined'),
  1,
  'a host marking a no-show notifies nobody');

-- ------------------------------------------------------------------
-- Final-review fix (Also fix item 2): a STALE write must not notify.
-- Profile 2's row currently says 'no_show', recorded_by the host a moment
-- ago (`recorded_at` frozen at this transaction's now()). Profile 2 now
-- self-reports 'no_show' too, but with an occurred_at BEHIND that stored
-- recorded_at -- the exact shape a deferred offline replay produces: a
-- write queued on a phone, replayed late, superseded by a decision already
-- on record. The upsert's own `where excluded.recorded_at >
-- check_ins.recorded_at` makes this a silent no-op (record_attendance
-- still returns success, per this plan's error-handling section). Before
-- the fix, the notification insert sat OUTSIDE that guard: a no-op write
-- still told the organizers "profile 2 can't make it" even though the
-- stored row was never touched. The dedupe key is keyed on
-- (event, declining profile, recipient) and profile 2 has never
-- self-declined before this point in the file, so a stray notification
-- here cannot be explained away by the earlier dedupe assertion above --
-- this is a genuinely new key.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$select public.record_attendance(
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002', 'no_show',
      now() - interval '10 minutes')$$,
  'a stale self-reported no_show is accepted without error (silent no-op)');

reset role;
select is(
  (select recorded_by from public.check_ins
    where event_id = '40000000-0000-0000-0000-000000000001'
      and profile_id = '10000000-0000-0000-0000-000000000002'),
  '10000000-0000-0000-0000-000000000001'::uuid,
  'the stale write did not actually apply -- recorded_by is still the host''s');

select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'attendance_declined'
      and payload->>'declined_by' = '10000000-0000-0000-0000-000000000002'),
  0,
  'a stale no-op write does not queue a notification the stored row does not back up');

-- The expiry rule: an attendance_declined row is queued at or after
-- starts_at by definition, so the event-bound default (expire at
-- starts_at) would make it stillborn. Confirm it gets the 24-hour
-- treatment instead.
select ok(
  (select public.outbox_expires_at(
            'attendance_declined', now(), now() - interval '1 hour'))
    > now(),
  'an attendance_declined row queued after kickoff has not already expired');

select * from finish();
rollback;
