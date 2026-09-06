begin;
set local search_path to extensions, public;

select plan(4);

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000061', 'host61@example.com'),
  ('a0000000-0000-0000-0000-000000000062', 'member62@example.com');

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('b0000000-0000-0000-0000-000000000061', 'Payments RLS Club',
          'payments-rls-club', 'America/New_York',
          'a0000000-0000-0000-0000-000000000061');
insert into public.club_members (club_id, profile_id, role, status) values
  ('b0000000-0000-0000-0000-000000000061',
   'a0000000-0000-0000-0000-000000000061', 'host', 'active'),
  ('b0000000-0000-0000-0000-000000000061',
   'a0000000-0000-0000-0000-000000000062', 'member', 'active')
  on conflict do nothing;
insert into public.venues (id, added_by_club_id, name, created_by)
  values ('c0000000-0000-0000-0000-000000000061',
          'b0000000-0000-0000-0000-000000000061', 'Hall',
          'a0000000-0000-0000-0000-000000000061');
insert into public.events (id, club_id, title, venue_id, starts_at, ends_at,
                           check_in_required, created_by)
  values ('d0000000-0000-0000-0000-000000000061',
          'b0000000-0000-0000-0000-000000000061', 'Game',
          'c0000000-0000-0000-0000-000000000061',
          now(), now() + interval '3 hours', true,
          'a0000000-0000-0000-0000-000000000061');

-- Two rows, one per member, written as the owner so this file tests the
-- POLICY and not the write functions (which don't exist until Task 6).
insert into public.event_payments
  (event_id, club_id, profile_id, marked_by) values
  ('d0000000-0000-0000-0000-000000000061',
   'b0000000-0000-0000-0000-000000000061',
   'a0000000-0000-0000-0000-000000000061',
   'a0000000-0000-0000-0000-000000000061'),
  ('d0000000-0000-0000-0000-000000000061',
   'b0000000-0000-0000-0000-000000000061',
   'a0000000-0000-0000-0000-000000000062',
   'a0000000-0000-0000-0000-000000000061');

-- As the plain member: the table must be completely invisible.
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000062","role":"authenticated"}';

select is(
  (select count(*)::int from public.event_payments),
  0,
  'a plain member sees no payment rows at all — not even their own');

select throws_ok(
  $$insert into public.event_payments
      (event_id, club_id, profile_id, marked_by)
    values ('d0000000-0000-0000-0000-000000000061',
            'b0000000-0000-0000-0000-000000000061',
            'a0000000-0000-0000-0000-000000000062',
            'a0000000-0000-0000-0000-000000000062')$$,
  '42501', null,
  'a member cannot insert a payment row directly');

select throws_ok(
  $$delete from public.event_payments$$,
  '42501', null,
  'a member cannot delete payment rows directly');

reset role;
set local role authenticated;
set local request.jwt.claims to
  '{"sub":"a0000000-0000-0000-0000-000000000061","role":"authenticated"}';

select is(
  (select count(*)::int from public.event_payments),
  2,
  'the host sees every payment row for their club');

select * from finish();
rollback;
