begin;
set local search_path to extensions, public;

select plan(8);

-- ------------------------------------------------------------------
-- Fixture identical to check_in.test.sql (Task 4), with two additions:
-- full_name on auth.users so display_name is populated, and Walk
-- (profile 4) recorded as a walk-in plus Ann (profile 2) marked arrived,
-- both by the host through record_attendance itself rather than writing
-- directly into check_ins (authenticated has no insert grant on it
-- anyway; reset role would work too, but exercising the real writer is
-- more honest about how these rows actually get created).
-- ------------------------------------------------------------------
-- Profiles 6 and 7 share a display_name ("Zoe") on purpose: display_name
-- has no uniqueness constraint, so two people at the same table can tie
-- on name the same way two never-named people would tie on ''. They pin
-- the order-by's tiebreaker (see the "two same-named tablemates" block
-- below).
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 'host@example.com', '{"full_name": "Host"}'::jsonb),
  ('10000000-0000-0000-0000-000000000002', 'ann@example.com', '{"full_name": "Ann"}'::jsonb),
  ('10000000-0000-0000-0000-000000000003', 'bob@example.com', '{"full_name": "Bob"}'::jsonb),
  ('10000000-0000-0000-0000-000000000004', 'walk@example.com', '{"full_name": "Walk"}'::jsonb),
  ('10000000-0000-0000-0000-000000000005', 'eve@example.com', '{"full_name": "Eve"}'::jsonb),
  ('10000000-0000-0000-0000-000000000006', 'zoe6@example.com', '{"full_name": "Zoe"}'::jsonb),
  ('10000000-0000-0000-0000-000000000007', 'zoe7@example.com', '{"full_name": "Zoe"}'::jsonb);

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
   '10000000-0000-0000-0000-000000000004', 'member', 'active'),
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000006', 'member', 'active'),
  ('20000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000007', 'member', 'active')
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
   '10000000-0000-0000-0000-000000000002', 'confirmed'),
  -- Two more seats at the same table, both named "Zoe" -- a tie on both
  -- of the first two order-by keys (table position, display_name).
  ('60000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000006',
   '10000000-0000-0000-0000-000000000002', 'confirmed'),
  ('60000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000007',
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
  5,
  'four booked players and one walk-in are five rows');

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
  5,
  'the record is still readable a month later');

-- ------------------------------------------------------------------
-- Two same-named tablemates: Ann, Bob, and the two Zoes (profiles 6
-- and 7) are all seated at Table 1. Ann and Bob sort apart on name
-- alone, but the two Zoes tie on both order-by keys the function had
-- before this fix (table position, display_name) — the only thing
-- separating them is the third key, profile_id.
--
-- This is not "read the order once and hope it matches" — a coincidental
-- tie often *does* come back in a consistent order for a small table,
-- which would make an assertion like that pass whether or not the
-- tiebreaker exists. The guarantee this assertion actually has is that
-- the order is now TOTAL (every key pair is distinct up to profile_id),
-- so profile 6 sorting before profile 7 is guaranteed by the ORDER BY
-- itself, not by an accident of execution. See the mutation check in
-- task-7-report.md for direct confirmation that removing the third key
-- turns this assertion's safety net into luck.
select results_eq(
  $$select profile_id from public.event_attendance(
      '40000000-0000-0000-0000-000000000001')
    where event_table_id = '50000000-0000-0000-0000-000000000001'$$,
  $$values
    ('10000000-0000-0000-0000-000000000002'::uuid),
    ('10000000-0000-0000-0000-000000000003'::uuid),
    ('10000000-0000-0000-0000-000000000006'::uuid),
    ('10000000-0000-0000-0000-000000000007'::uuid)$$,
  'same-named tablemates still get a total, deterministic order -- ' ||
  'profile_id as a third key, not luck, is what guarantees this');

select * from finish();
rollback;
