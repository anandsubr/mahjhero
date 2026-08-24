begin;
set local search_path to extensions, public;

select plan(10);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- E1 starts in 90 minutes: both the 1440 and the 120 threshold are behind
-- us. E2 starts in 20 hours: only 1440. E3 starts in 3 days: neither.
insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tonight',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '90 minutes', now() + interval '4 hours 30 minutes',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tomorrow',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '20 hours', now() + interval '23 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Next week',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '3 days', now() + interval '3 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1),
  ('7ab1e000-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 'beginner', 4, 1);

-- booking_groups enforces (status = 'waitlisted') = (waitlisted_at is not
-- null), so the waitlisted row below needs a waitlisted_at set.
insert into public.booking_groups
  (id, event_id, club_id, created_by, status, waitlisted_at)
  values
  ('9409409e-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('9409409e-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('9409409e-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed', null),
  ('9409409e-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'waitlisted', now());

insert into public.bookings
  (group_id, event_id, club_id, event_table_id, profile_id, booked_by, status)
  values
  ('9409409e-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  ('9409409e-0000-0000-0000-000000000002',
   'e2e2e2e2-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  ('9409409e-0000-0000-0000-000000000003',
   'e3e3e3e3-0000-0000-0000-000000000003',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed'),
  -- Waitlisted, so no table and, the point of this row, no reminder.
  ('9409409e-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   null,
   'cccccccc-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003', 'waitlisted');

-- Three: two thresholds for tonight's game, one for tomorrow's.
select is(
  public.queue_event_reminders(),
  3,
  'each crossed threshold queues one reminder per confirmed booking'
);
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_reminder'
      and event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  2,
  'a game 90 minutes away has crossed both the 24-hour and 2-hour marks'
);
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_reminder'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'),
  1,
  'a game 20 hours away has crossed only the 24-hour mark'
);
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_reminder'
      and event_id = 'e3e3e3e3-0000-0000-0000-000000000003'),
  0,
  'a game three days away has crossed nothing'
);
select ok(
  not exists (select 1 from public.notification_outbox
               where kind = 'event_reminder'
                 and recipient_id = 'cccccccc-0000-0000-0000-000000000003'),
  'a waitlisted member has no seat to be reminded of'
);

-- The whole idempotency story. The job asks "has this threshold been
-- crossed", never "was it crossed in the last 15 minutes" — so a missed
-- tick catches up and a double tick is free.
select is(
  public.queue_event_reminders(),
  0,
  'running the job again queues nothing'
);
select is(
  (select count(*)::int from public.notification_outbox
    where kind = 'event_reminder'),
  3,
  'and leaves the queue exactly as it was'
);

-- The template needs to know which threshold this is, to choose between
-- "tomorrow" and "in two hours".
select is(
  (select (payload->>'offset_minutes')::int
     from public.notification_outbox
    where kind = 'event_reminder'
      and event_id = 'e2e2e2e2-0000-0000-0000-000000000002'),
  1440,
  'the payload names which threshold produced it'
);

-- A cancelled game reminds nobody.
delete from public.notification_outbox;
update public.events set status = 'cancelled'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
select is(
  (select count(*)::int
     from (select public.queue_event_reminders()) q,
          public.notification_outbox o
    where o.kind = 'event_reminder'
      and o.event_id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  0,
  'a cancelled game reminds nobody'
);

select has_function('public', 'queue_event_reminders',
                    'the reminder producer exists');

select * from finish();
rollback;
