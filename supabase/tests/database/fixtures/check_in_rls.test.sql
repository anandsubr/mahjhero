begin;
set local search_path to extensions, public;

select plan(4);

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'ann@example.com'),
  ('a0000000-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('b0000000-0000-0000-0000-000000000001', 'RLS Club', 'rls-club',
          'America/New_York', 'a0000000-0000-0000-0000-000000000001');
insert into public.club_members (club_id, profile_id, role, status) values
  ('b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001', 'host', 'active'),
  ('b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000002', 'member', 'active')
  on conflict do nothing;
insert into public.venues (id, added_by_club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-000000000001', 'Hall',
          'a0000000-0000-0000-0000-000000000001');
insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           check_in_required, created_by)
  values ('d0000000-0000-0000-0000-000000000001',
          'b0000000-0000-0000-0000-000000000001', 'Game',
          'c0000000-0000-0000-0000-000000000001',
          now(), now() + interval '3 hours', true,
          'a0000000-0000-0000-0000-000000000001');

-- Two rows, one per member, written as the owner so this file tests the
-- POLICY and not the write functions.
insert into public.check_ins
  (event_id, club_id, profile_id, state, recorded_by) values
  ('d0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001', 'arrived',
   'a0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000002', 'arrived',
   'a0000000-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  (select count(*)::int from public.check_ins),
  1,
  'a member sees exactly one row — their own');

select is(
  (select profile_id from public.check_ins),
  'a0000000-0000-0000-0000-000000000002'::uuid,
  'and it is theirs, not the host''s');

-- No write policy exists, and no DML is granted. Both must hold: a grant
-- without a policy fails, and a policy without a revoke lets TRUNCATE
-- through regardless.
select throws_ok(
  $$insert into public.check_ins
      (event_id, club_id, profile_id, state, recorded_by)
    values ('d0000000-0000-0000-0000-000000000001',
            'b0000000-0000-0000-0000-000000000001',
            'a0000000-0000-0000-0000-000000000002', 'no_show',
            'a0000000-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'a member cannot insert a check_in directly');

select throws_ok(
  $$delete from public.check_ins$$,
  '42501',
  null,
  'a member cannot delete check_ins directly');

select * from finish();
rollback;
