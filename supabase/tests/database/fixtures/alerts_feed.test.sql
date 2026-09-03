begin;
set local search_path to extensions, public;

select plan(11);

-- Alice is the recipient under test. Bob exists only to prove ownership:
-- his own outbox row must never surface in Alice's feed. Both need a club
-- to satisfy notification_outbox.club_id's not-null FK -- the function
-- under test scopes by recipient_id alone, so sharing one club between
-- them is enough; nothing here exercises club membership.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

update public.profiles set display_name = 'Alice Ng'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Bob Iyer'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

-- Two rows for Alice, explicit created_at so "most recent first" is not
-- left to same-transaction now() collisions -- the same reasoning
-- thread_reads_api.test.sql documents for its two messages.
insert into public.notification_outbox
  (id, recipient_id, club_id, kind, payload, dedupe_key, created_at) values
  ('11111111-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'booked_by_friend', '{}'::jsonb, 'alerts_test:1',
   now() - interval '10 minutes'),
  ('11111111-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'broadcast', '{}'::jsonb, 'alerts_test:2',
   now() - interval '5 minutes');

-- Bob's own row -- must stay invisible to Alice's fetch.
insert into public.notification_outbox
  (id, recipient_id, club_id, kind, payload, dedupe_key, created_at) values
  ('22222222-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'booked_by_friend', '{}'::jsonb, 'alerts_test:bob1',
   now() - interval '5 minutes');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- fetch_my_notifications: both of Alice's rows, most recent first.
-- ---------------------------------------------------------------------

select is(
  (select count(*)::int from public.fetch_my_notifications()),
  2,
  'fetch_my_notifications returns both of Alice''s rows'
);

select is(
  (select array_agg(id order by created_at desc)
     from public.fetch_my_notifications()),
  array['11111111-0000-0000-0000-000000000002'::uuid,
        '11111111-0000-0000-0000-000000000001'::uuid],
  'most recent (the broadcast) first'
);

-- Scenario 2: a member sees only their own rows.
select is(
  (select count(*)::int from public.fetch_my_notifications()
    where id = '22222222-0000-0000-0000-000000000001'),
  0,
  'Bob''s own outbox row does not appear in Alice''s feed'
);

-- ---------------------------------------------------------------------
-- my_notification_unread_count: live against notification_outbox, then
-- zeroed by mark_notifications_read, then live again for anything new.
-- ---------------------------------------------------------------------

select is(
  (select public.my_notification_unread_count()),
  2,
  'the full count is unread before any read'
);

select public.mark_notifications_read();

select is(
  (select public.my_notification_unread_count()),
  0,
  'unread count is zero immediately after mark_notifications_read'
);

-- The watermark is Alice's own row and nobody else's -- notification_reads_own
-- exercised for select, the same idiom push_tokens_own establishes.
select is(
  (select count(*)::int from public.notification_reads
    where recipient_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'mark_notifications_read upserts exactly one watermark row for Alice'
);

insert into public.notification_outbox
  (id, recipient_id, club_id, kind, payload, dedupe_key, created_at) values
  ('11111111-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'need_a_fourth', '{}'::jsonb, 'alerts_test:3', now());

select is(
  (select public.my_notification_unread_count()),
  1,
  'a row created after the read watermark is counted again'
);

-- ---------------------------------------------------------------------
-- Scenario 4: fetch_my_notifications shows a row regardless of delivery
-- outcome -- one of each terminal state, none of them filtered out.
-- notification_outbox_one_terminal_state (20260826010000) forbids more
-- than one of these three being set on the same row, so each state gets
-- its own row rather than combining them.
-- ---------------------------------------------------------------------

insert into public.notification_outbox
  (id, recipient_id, club_id, kind, payload, dedupe_key, created_at, sent_at)
  values
  ('11111111-0000-0000-0000-000000000004',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'event_reminder', '{}'::jsonb, 'alerts_test:4', now(), now());

insert into public.notification_outbox
  (id, recipient_id, club_id, kind, payload, dedupe_key, created_at, failed_at)
  values
  ('11111111-0000-0000-0000-000000000005',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'unseated', '{}'::jsonb, 'alerts_test:5', now(), now());

insert into public.notification_outbox
  (id, recipient_id, club_id, kind, payload, dedupe_key, created_at, expired_at)
  values
  ('11111111-0000-0000-0000-000000000006',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'promotion_offer_expired', '{}'::jsonb, 'alerts_test:6', now(), now());

select is(
  (select count(*)::int from public.fetch_my_notifications()),
  6,
  'fetch_my_notifications now carries all six of Alice''s rows'
);

select is(
  (select count(*)::int from public.fetch_my_notifications()
    where id = '11111111-0000-0000-0000-000000000004'),
  1,
  'a sent row still appears'
);
select is(
  (select count(*)::int from public.fetch_my_notifications()
    where id = '11111111-0000-0000-0000-000000000005'),
  1,
  'a failed row still appears'
);
select is(
  (select count(*)::int from public.fetch_my_notifications()
    where id = '11111111-0000-0000-0000-000000000006'),
  1,
  'an expired row still appears'
);

-- ---------------------------------------------------------------------
-- Scenario 5 (no session) is intentionally skipped. thread_reads_api.test.sql
-- and every other pgTAP fixture in supabase/tests/database/fixtures/
-- simulate a *different* user by switching request.jwt.claims to that
-- user's sub, never by leaving auth.uid() null under role authenticated --
-- `reset role` elsewhere in this suite drops back to the superuser role
-- entirely, which is not the same thing as an authenticated session with
-- no JWT. With no established pattern in this repo for simulating that
-- specific state, this fixture does not invent one.
-- ---------------------------------------------------------------------

select * from finish();
rollback;
