begin;
set local search_path to extensions, public;

select plan(7);

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-000000000001', 'host-a@example.com'),
  ('e0000000-0000-0000-0000-000000000002', 'member-a@example.com'),
  ('e0000000-0000-0000-0000-000000000003', 'host-b@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('f0000000-0000-0000-0000-000000000001', 'Club A', 'club-a',
   'America/New_York', 'e0000000-0000-0000-0000-000000000001'),
  ('f0000000-0000-0000-0000-000000000002', 'Club B', 'club-b',
   'America/New_York', 'e0000000-0000-0000-0000-000000000003');

insert into public.club_members (club_id, profile_id, role, status) values
  ('f0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000001', 'host', 'active'),
  ('f0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000002', 'member', 'active'),
  ('f0000000-0000-0000-0000-000000000002',
   'e0000000-0000-0000-0000-000000000003', 'host', 'active')
  on conflict do nothing;

insert into public.venues (id, added_by_club_id, name, created_by) values
  ('a1000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 'Hall A',
   'e0000000-0000-0000-0000-000000000001');

insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           created_by) values
  ('a2000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001', 'Club A Game',
   'a1000000-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() + interval '2 hours',
   'e0000000-0000-0000-0000-000000000001');

insert into public.event_tables (id, event_id, club_id, label, position)
  values ('a3000000-0000-0000-0000-000000000001',
          'a2000000-0000-0000-0000-000000000001',
          'f0000000-0000-0000-0000-000000000001', 'Table 1', 1);

-- Written as the owner (elevated role, bypasses nothing that matters here —
-- this file tests the SELECT POLICY, not record_round's own guard ladder).
insert into public.table_rounds
  (event_table_id, event_id, club_id, winner_profile_id, points, recorded_by)
values
  ('a3000000-0000-0000-0000-000000000001',
   'a2000000-0000-0000-0000-000000000001',
   'f0000000-0000-0000-0000-000000000001',
   'e0000000-0000-0000-0000-000000000002', 8,
   'e0000000-0000-0000-0000-000000000001');

-- A plain member of the same club reads it.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"e0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.table_rounds),
  1,
  'a member of the round''s own club can read it'
);

select is(
  (select total_points from public.club_leaderboard(
     'f0000000-0000-0000-0000-000000000001')
   where profile_id = 'e0000000-0000-0000-0000-000000000002'),
  8,
  'club_leaderboard totals a member''s own club standings'
);

reset role;

-- The host of an unrelated club cannot see it at all.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"e0000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*)::int from public.table_rounds),
  0,
  'a host of a different club reads nothing'
);

-- club_leaderboard is security definer, so RLS does not protect it and the
-- is_club_member check in its body is the tenant boundary. Host B does not
-- belong to Club A.
select is(
  (select count(*)::int from public.club_leaderboard(
     'f0000000-0000-0000-0000-000000000001')),
  0,
  'club_leaderboard returns nothing for a club the caller does not belong to'
);

select throws_ok(
  $$insert into public.table_rounds
      (event_table_id, event_id, club_id, winner_profile_id, points, recorded_by)
    values
      ('a3000000-0000-0000-0000-000000000001',
       'a2000000-0000-0000-0000-000000000001',
       'f0000000-0000-0000-0000-000000000001',
       'e0000000-0000-0000-0000-000000000003', 4,
       'e0000000-0000-0000-0000-000000000003')$$,
  '42501',
  null,
  'authenticated has no INSERT on table_rounds'
);

select throws_ok(
  $$update public.table_rounds set points = 99$$,
  '42501',
  null,
  'authenticated has no UPDATE on table_rounds'
);

select throws_ok(
  $$delete from public.table_rounds$$,
  '42501',
  null,
  'authenticated has no DELETE on table_rounds'
);

reset role;

select * from finish();
rollback;
