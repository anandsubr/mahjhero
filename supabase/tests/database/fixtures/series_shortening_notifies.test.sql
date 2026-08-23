begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(7);

/*
 * update_event_series (20260825042000) has to tell the people it unseats
 * when shortening a series' run deletes an occurrence they were booked
 * into. This is its own file, not an extension of event_disruption.test.sql
 * or event_series_edits.test.sql, because the scenario needs both series
 * materialization AND live bookings on generated occurrences at once --
 * neither existing fixture sets up that combination, and bolting it onto
 * either would mean carrying the other file's unrelated setup along for
 * the ride.
 *
 * The series starts entirely in the future (current_date + 3) on purpose:
 * the past/future boundary is already covered exhaustively by
 * event_series_edits.test.sql, and this file has one job -- the shortening
 * DELETE and what it now writes before it fires -- so there is no reason
 * to also carry a past occurrence through it.
 *
 * Two host actions, same series:
 *
 *   1. Cap ends_on to current_date + 10. Occurrences at +17, +24, +31, +38
 *      fall outside the run and are deleted. Mallory (confirmed, +17) and
 *      Ned (waitlisted, +24) are still booked into two of them; Carol
 *      (confirmed, +3) is not -- her occurrence is kept.
 *   2. Cap ends_on again, to current_date + 3. This deletes +10, which
 *      nobody is booked into. Nothing should be written.
 */

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('11110000-0000-0000-0000-000000000001', 'mallory@example.com'),
  ('11110000-0000-0000-0000-000000000002', 'ned@example.com'),
  ('11110000-0000-0000-0000-000000000003', 'carol@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000001', 'member'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000002', 'member'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000003', 'member');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.create_event_series(
      'c1c1c1c1-0000-0000-0000-000000000001', 'Weekly game',
      '11111111-0000-0000-0000-000000000001', '',
      'weekly', extract(dow from current_date + 3)::smallint, null,
      '19:00'::time, 180, 1,
      current_date + 3, null)$$,
  'an organizer starts a weekly series with no end date'
);

reset role;

-- Occurrences at +3, +10, +17, +24, +31, +38 now exist (42-day horizon).
-- Book Mallory and Ned into two of the ones about to fall outside the
-- shortened run, and Carol into the one that stays, all as direct inserts
-- -- the booking planner is not what this file is testing.
insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('99990000-0000-0000-0000-000000000001',
   (select id from public.events
     where series_id = (select id from public.event_series
                          where title = 'Weekly game')
       and occurrence_date = current_date + 17),
   'c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000001');
insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by) values
  ('99990000-0000-0000-0000-000000000001',
   (select id from public.events
     where series_id = (select id from public.event_series
                          where title = 'Weekly game')
       and occurrence_date = current_date + 17),
   'c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000001');

insert into public.booking_groups
  (id, event_id, club_id, created_by, status, waitlisted_at) values
  ('99990000-0000-0000-0000-000000000002',
   (select id from public.events
     where series_id = (select id from public.event_series
                          where title = 'Weekly game')
       and occurrence_date = current_date + 24),
   'c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000002', 'waitlisted', now());
insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status) values
  ('99990000-0000-0000-0000-000000000002',
   (select id from public.events
     where series_id = (select id from public.event_series
                          where title = 'Weekly game')
       and occurrence_date = current_date + 24),
   'c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000002',
   '11110000-0000-0000-0000-000000000002', 'waitlisted');

insert into public.booking_groups (id, event_id, club_id, created_by) values
  ('99990000-0000-0000-0000-000000000003',
   (select id from public.events
     where series_id = (select id from public.event_series
                          where title = 'Weekly game')
       and occurrence_date = current_date + 3),
   'c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000003');
insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by) values
  ('99990000-0000-0000-0000-000000000003',
   (select id from public.events
     where series_id = (select id from public.event_series
                          where title = 'Weekly game')
       and occurrence_date = current_date + 3),
   'c1c1c1c1-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000003',
   '11110000-0000-0000-0000-000000000003');

-- ---------------------------------------------------------------------
-- 1. Shortening to +10 deletes +17, +24, +31, +38. Mallory and Ned are
--    still sitting in two of those; Carol is not.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series where title = 'Weekly game'),
      null, null, null, null, null, null, current_date + 10)$$,
  'the host shortens the run to end in ten days'
);

reset role;

select set_eq(
  $$select recipient_id from public.notification_outbox
     where kind = 'event_cancelled'
       and payload->>'series_id'
             = (select id from public.event_series
                 where title = 'Weekly game')::text$$,
  ARRAY['11110000-0000-0000-0000-000000000001',
        '11110000-0000-0000-0000-000000000002']::uuid[],
  'exactly the two members still booked on a dropped week are told, once each'
);

-- Both rows have event_id = null (the occurrence they describe is gone),
-- and the occurrence id each one carries in its payload really is gone --
-- proving the outbox row outlived the DELETE that produced it, rather than
-- being cascade-deleted along with the row it pointed at.
select is(
  (select count(*)::int from public.notification_outbox o
    where o.kind = 'event_cancelled'
      and o.payload->>'series_id'
            = (select id from public.event_series
                where title = 'Weekly game')::text
      and o.event_id is null
      and not exists (
        select 1 from public.events e
         where e.id = (o.payload->>'event_id')::uuid
      )),
  2,
  'both outbox rows survive the delete, carrying the vanished occurrence''s id'
);

select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_cancelled' and recipient_id = '11110000-0000-0000-0000-000000000003'),
  0,
  'Carol, whose occurrence was kept, hears nothing');

-- ---------------------------------------------------------------------
-- 2. Shortening again to +3 deletes only +10, which nobody is booked
--    into. Nothing new should be written.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_event_series(
      (select id from public.event_series where title = 'Weekly game'),
      null, null, null, null, null, null, current_date + 3)$$,
  'the host shortens the run again, past a week nobody is booked into'
);

reset role;

select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_cancelled'
      and payload->>'series_id'
            = (select id from public.event_series
                where title = 'Weekly game')::text),
  2,
  'and a shortening that removes no booked occurrence writes nothing new');

select * from finish();
rollback;
