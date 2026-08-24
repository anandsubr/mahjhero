begin;
set local search_path to extensions, public;

select plan(16);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),  -- host
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),    -- member, booked
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),  -- member, not booked
  ('dddddddd-0000-0000-0000-000000000004', 'dan@example.com');    -- another club entirely

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Hillside', 'hillside',
   'America/New_York', 'dddddddd-0000-0000-0000-000000000004');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000004', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'The Annexe',
   'c2c2c2c2-0000-0000-0000-000000000002',
   'dddddddd-0000-0000-0000-000000000004');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday night',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '2 days', now() + interval '2 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  -- Belongs to the OTHER club. The cross-club assertion below aims at it.
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c2c2c2c2-0000-0000-0000-000000000002', 'Their night',
   '11111111-0000-0000-0000-000000000002',
   now() + interval '2 days', now() + interval '2 days 3 hours',
   'dddddddd-0000-0000-0000-000000000004');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1);

-- Bob is booked; Carol is not. Event-scoped broadcasts must tell the
-- difference, and club-wide ones must not.
insert into public.booking_groups (id, event_id, club_id, created_by, status)
  values ('9409409e-0000-0000-0000-000000000001',
          'e1e1e1e1-0000-0000-0000-000000000001',
          'c1c1c1c1-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed');
insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by, status)
  values ('9409409e-0000-0000-0000-000000000001',
          'e1e1e1e1-0000-0000-0000-000000000001',
          'c1c1c1c1-0000-0000-0000-000000000001',
          '7ab1e000-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000002',
          'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed');

-- ---------------------------------------------------------------------
-- A host broadcasting to the whole roster.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.send_broadcast(
      'c1c1c1c1-0000-0000-0000-000000000001', null,
      'Doors open at seven', 'The side entrance is locked this week.')$$,
  'a host can broadcast to the roster'
);

/*
 * notification_outbox has no grant to `authenticated` at all — by design
 * (see 20260825000000_create_bookings.sql: "No grant on notification_outbox
 * to anyone but service_role"). Reading it directly, as opposed to through
 * a security-definer function, requires stepping out of role authenticated
 * for the read. This mirrors the ordering need_a_fourth.test.sql already
 * uses: outbox assertions run outside `set local role authenticated`.
 * `public.broadcasts` does not need this — it has its own grant + RLS
 * policy to authenticated, exercised deliberately below.
 */
reset role;

-- Two, not three: the author is not mailed their own announcement.
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'broadcast'),
  2,
  'a club-wide broadcast reaches every member except its author'
);
select is(
  (select recipient_count from public.broadcasts
    where subject = 'Doors open at seven'),
  2,
  'recipient_count is written in the same transaction as the fan-out'
);
select ok(
  not exists (select 1 from public.notification_outbox
               where kind = 'broadcast'
                 and recipient_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'the author is not a recipient of their own broadcast'
);

-- ---------------------------------------------------------------------
-- Event-scoped: only the booked.
-- ---------------------------------------------------------------------
set local role authenticated;

select lives_ok(
  $$select public.send_broadcast(
      'c1c1c1c1-0000-0000-0000-000000000001',
      'e1e1e1e1-0000-0000-0000-000000000001',
      'Bring a spare card', 'Mine has seen better days.')$$,
  'a host can broadcast to one event'
);

reset role;

select is(
  (select recipient_count from public.broadcasts
    where subject = 'Bring a spare card'),
  1,
  'an event broadcast reaches only the booked'
);
select ok(
  exists (select 1 from public.notification_outbox o
           join public.broadcasts b
             on b.id::text = o.payload->>'broadcast_id'
          where b.subject = 'Bring a spare card'
            and o.recipient_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'the booked member is told'
);
select ok(
  not exists (select 1 from public.notification_outbox o
               join public.broadcasts b
                 on b.id::text = o.payload->>'broadcast_id'
              where b.subject = 'Bring a spare card'
                and o.recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  'a member who is not booked is not told'
);

-- The count the compose screen shows before sending must agree with what
-- the fan-out actually does, or the confirmation lies.
set local role authenticated;

select is(
  public.broadcast_recipient_count(
    'c1c1c1c1-0000-0000-0000-000000000001', null),
  2,
  'the previewed count matches the club-wide fan-out'
);
select is(
  public.broadcast_recipient_count(
    'c1c1c1c1-0000-0000-0000-000000000001',
    'e1e1e1e1-0000-0000-0000-000000000001'),
  1,
  'the previewed count matches the event fan-out'
);

-- ---------------------------------------------------------------------
-- Tenancy.
-- ---------------------------------------------------------------------
select throws_ok(
  $$select public.send_broadcast(
      'c1c1c1c1-0000-0000-0000-000000000001',
      'e2e2e2e2-0000-0000-0000-000000000002',
      'Wrong club', 'This event is not theirs.')$$,
  '42501',
  null,
  'a host cannot broadcast to an event in another club'
);

set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select public.send_broadcast(
      'c1c1c1c1-0000-0000-0000-000000000001', null,
      'Not my place', 'I am only a member.')$$,
  '42501',
  null,
  'an ordinary member cannot broadcast'
);

-- A member cannot read what the organizers sent, either.
select is(
  (select count(*)::int from public.broadcasts),
  0,
  'a member reads no broadcasts'
);

set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.broadcasts),
  2,
  'an organizer reads their club''s broadcasts'
);

reset role;

select ok(
  not has_table_privilege('authenticated', 'public.broadcasts', 'INSERT'),
  'authenticated cannot INSERT broadcasts directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.broadcasts', 'TRUNCATE'),
  'authenticated cannot TRUNCATE broadcasts'
);

select * from finish();
rollback;
