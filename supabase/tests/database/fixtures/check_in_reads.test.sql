begin;
set local search_path to extensions, public;

select plan(7);

-- ------------------------------------------------------------------
-- Fixture identical to check_in.test.sql (Task 4), with two additions:
-- full_name on auth.users so display_name is populated, and Walk
-- (profile 4) recorded as a walk-in plus Ann (profile 2) marked arrived,
-- both by the host through record_attendance itself rather than writing
-- directly into check_ins (authenticated has no insert grant on it
-- anyway; reset role would work too, but exercising the real writer is
-- more honest about how these rows actually get created).
-- ------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 'host@example.com', '{"full_name": "Host"}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'ann@example.com', '{"full_name": "Ann"}'::jsonb),
  ('10000000-0000-0000-0000-000000000003', 'bob@example.com', '{"full_name": "Bob"}'::jsonb),
  ('10000000-0000-0000-0000-000000000004', 'walk@example.com', '{"full_name": "Walk"}'::jsonb),
  ('10000000-0000-0000-0000-000000000005', 'eve@example.com', '{"full_name": "Eve"}'::jsonb);

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

-- The game is IN PROGRESS: started an hour ago, ends in two.
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

-- Walk (profile 4) is recorded as a walk-in, and Ann (profile 2) is
-- marked arrived, both by the host, before any read is attempted.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$ begin
  perform public.record_attendance(
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002', 'arrived');
  perform public.record_attendance(
    '40000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000004', 'arrived');
end $$;

reset role;

-- ------------------------------------------------------------------
-- The door list itself.
-- ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.event_attendance(
     '40000000-0000-0000-0000-000000000001')),
  3,
  'two booked players and one walk-in are three rows');

select is(
  (select booking_status::text from public.event_attendance(
     '40000000-0000-0000-0000-000000000001')
    where profile_id = '10000000-0000-0000-0000-000000000004'),
  null,
  'a walk-in has a null booking_status, which is what identifies them');

select is(
  (select state::text from public.event_attendance(
     '40000000-0000-0000-0000-000000000001')
    where profile_id = '10000000-0000-0000-0000-000000000002'),
  'arrived',
  'a recorded state comes back');

select is(
  (select state::text from public.event_attendance(
     '40000000-0000-0000-0000-000000000001')
    where profile_id = '10000000-0000-0000-0000-000000000003'),
  null,
  'an unrecorded booking is null — not determined, not a no-show');

select is(
  (select display_name from public.event_attendance(
     '40000000-0000-0000-0000-000000000001')
    where profile_id = '10000000-0000-0000-0000-000000000003'),
  'Bob',
  'names are published — a client-side join to profiles would return null');

-- An ordinary member is not an organizer, and gets an error rather than an
-- empty set: an empty set is indistinguishable from "nobody has arrived".
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select * from public.event_attendance(
      '40000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a plain member cannot read the door list');

-- Reads are NOT window-bound. Only writes are.
reset role;
update public.events
   set starts_at = now() - interval '30 days',
       ends_at   = now() - interval '30 days' + interval '3 hours'
 where id = '40000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  (select count(*)::int from public.event_attendance(
     '40000000-0000-0000-0000-000000000001')),
  3,
  'the record is still readable a month later');

select * from finish();
rollback;
