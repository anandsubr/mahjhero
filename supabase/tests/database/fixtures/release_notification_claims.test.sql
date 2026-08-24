begin;
set local search_path to extensions, public;

select plan(37);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Tuesday night',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '2 days', now() + interval '2 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001');

select has_column('public', 'notification_outbox', 'connection_break_count',
                  'connection_break_count exists');
select col_not_null('public', 'notification_outbox', 'connection_break_count',
                    'connection_break_count is not null');
select col_default_is('public', 'notification_outbox', 'connection_break_count',
                      '0', 'connection_break_count defaults to 0');

-- ---------------------------------------------------------------------
-- A spared row: claimed this tick but never even attempted. A full
-- refund of the attempt the claim burned, every time -- nothing about a
-- spared row is evidence of anything.
-- ---------------------------------------------------------------------
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'release:spared');

select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'the row is claimed, burning an attempt'
);
select is(
  (select attempts from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  1,
  'and attempts reads 1 before it is released'
);

select lives_ok(
  $$select public.release_notification_claims(
      array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])$$,
  'releasing a spared row does not raise'
);
select is(
  (select attempts from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  0,
  'the attempt the claim burned is refunded'
);
select ok(
  (select next_attempt_at > now() + interval '4 minutes'
     from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  'and it is given a fresh five-minute lease, not left immediately due'
);
select ok(
  (select failed_at is null and expired_at is null
     from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  'a released row is neither failed nor expired -- simply pending again'
);

-- Releasing the same row again (an at-least-once retry of the RPC call
-- itself, or the row simply was not reclaimed in between) must not drive
-- attempts negative.
select lives_ok(
  $$select public.release_notification_claims(
      array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])$$,
  'releasing an already-released row does not raise'
);
select is(
  (select attempts from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  0,
  'attempts does not go negative'
);

-- Terminal rows are left alone, same posture as mark_notifications_sent
-- and mark_notifications_failed: an at-least-once retry of this RPC call
-- must not resurrect or otherwise disturb a row already at rest. Checked
-- here, on this same row, before the next scenario clears the table.
select is(
  public.mark_notifications_sent(
    array['0b0b0b0b-0000-0000-0000-000000000001'::uuid]),
  1,
  'the spared row is marked sent, to make it terminal'
);
select lives_ok(
  $$select public.release_notification_claims(
      array['0b0b0b0b-0000-0000-0000-000000000001'::uuid],
      '0b0b0b0b-0000-0000-0000-000000000001', 'connect refused')$$,
  'releasing an already-sent row does not raise'
);
select ok(
  (select sent_at is not null and attempts = 0 and connection_break_count = 0
     from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  'and leaves the sent row exactly as it was'
);

-- ---------------------------------------------------------------------
-- The triggering row: the one whose own send produced the error the
-- batch broke on. Refunded the same way as a spared row, below the
-- escape hatch's threshold -- one or two connection-shaped breaks in a
-- row is still more plausibly the relay than this one address.
-- ---------------------------------------------------------------------
delete from public.notification_outbox;
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'release:trigger');

select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'the triggering row is claimed too, burning its own attempt'
);

select lives_ok(
  $$select public.release_notification_claims(
      array[]::uuid[], '0b0b0b0b-0000-0000-0000-000000000002',
      'connect ECONNREFUSED 127.0.0.1:25')$$,
  'releasing a triggering row does not raise'
);
select is(
  (select attempts from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000002'),
  0,
  'the triggering row is refunded too, the first time it breaks'
);
select is(
  (select connection_break_count from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000002'),
  1,
  'and its break streak is now 1'
);
select ok(
  (select failed_at is null from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000002'),
  'not failed -- one break in a row is still plausibly the relay'
);

-- ---------------------------------------------------------------------
-- The escape hatch: the SAME row breaking outbox_connection_break_limit()
-- times in a row stops being spared, so it can no longer wedge every
-- batch behind it forever.
-- ---------------------------------------------------------------------
select is(
  public.outbox_connection_break_limit(), 3,
  'the escape hatch trips at three consecutive breaks'
);

-- Reclaiming for a second and third attempt would need real wall-clock
-- time to pass -- `release_notification_claims` deliberately leases the
-- row five real minutes back out, and this transaction's `now()` is fixed
-- for its whole duration, so `claim_notification_batch` would correctly
-- refuse to see it as due yet. `attempts + 1` is reproduced directly
-- instead: it is exactly what claiming does to a row's `attempts`, and
-- this scenario is about `release_notification_claims`'s own bookkeeping,
-- not about racing the lease.
update public.notification_outbox
   set attempts = attempts + 1
 where id = '0b0b0b0b-0000-0000-0000-000000000002';
select lives_ok(
  $$select public.release_notification_claims(
      array[]::uuid[], '0b0b0b0b-0000-0000-0000-000000000002',
      'connect ECONNREFUSED 127.0.0.1:25')$$,
  'the second consecutive break does not raise'
);
select is(
  (select connection_break_count from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000002'),
  2,
  'the streak is now 2, still below the limit'
);

update public.notification_outbox
   set attempts = attempts + 1
 where id = '0b0b0b0b-0000-0000-0000-000000000002';
select lives_ok(
  $$select public.release_notification_claims(
      array[]::uuid[], '0b0b0b0b-0000-0000-0000-000000000002',
      'connect ECONNREFUSED 127.0.0.1:25')$$,
  'the third consecutive break, which trips the escape hatch, does not raise'
);
select is(
  (select attempts from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000002'),
  1,
  'the third break in a row is NOT refunded -- attempts stays at what the claim burned'
);
select is(
  (select connection_break_count from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000002'),
  0,
  'and the streak resets once the escape hatch has fired'
);
select is(
  (select last_error from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000002'),
  'connect ECONNREFUSED 127.0.0.1:25',
  'recorded like any other failure now -- mark_notifications_failed ran for real'
);
select ok(
  (select failed_at is null and next_attempt_at > now()
     from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000002'),
  'not dead-lettered yet -- only its first real attempt has been spent'
);

-- A row that has already spent its whole budget by the time the escape
-- hatch trips dead-letters immediately, exactly like an ordinary
-- mark_notifications_failed call at the ceiling does.
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key,
   attempts, connection_break_count) values
  ('0b0b0b0b-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'release:ceiling',
   public.outbox_max_attempts(), public.outbox_connection_break_limit() - 1);

select lives_ok(
  $$select public.release_notification_claims(
      array[]::uuid[], '0b0b0b0b-0000-0000-0000-000000000003',
      'connect ETIMEDOUT')$$,
  'the escape hatch firing at the attempts ceiling does not raise'
);
select ok(
  (select failed_at is not null from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000003'),
  'and dead-letters the row outright -- its budget was already spent when the streak tripped'
);

-- ---------------------------------------------------------------------
-- The break streak resets on any normal outcome, not only via the escape
-- hatch itself -- a row that broke once, then recovered on its own
-- (mark_notifications_sent) or failed for an ordinary reason of its own
-- (mark_notifications_failed), must not carry that count into some later,
-- unrelated occasion.
-- ---------------------------------------------------------------------
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key,
   connection_break_count) values
  ('0b0b0b0b-0000-0000-0000-000000000004',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'release:resets-on-send', 2),
  ('0b0b0b0b-0000-0000-0000-000000000005',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'release:resets-on-fail', 2);

select is(
  public.mark_notifications_sent(
    array['0b0b0b0b-0000-0000-0000-000000000004'::uuid]),
  1,
  'a row with a live break streak can still be marked sent'
);
select is(
  (select connection_break_count from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000004'),
  0,
  'and sending resets its break streak'
);

select lives_ok(
  $$select public.mark_notifications_failed(
      '0b0b0b0b-0000-0000-0000-000000000005', '550 no such user')$$,
  'a row with a live break streak can still fail for its own reason'
);
select is(
  (select connection_break_count from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000005'),
  0,
  'and an ordinary failure resets its break streak too'
);

-- ---------------------------------------------------------------------
-- Grants: service_role and nothing else, same posture as every other
-- internal drain function.
-- ---------------------------------------------------------------------
select ok(
  not has_function_privilege(
    'authenticated',
    'public.release_notification_claims(uuid[], uuid, text)', 'EXECUTE'),
  'authenticated cannot execute release_notification_claims'
);
select ok(
  not has_function_privilege(
    'anon', 'public.release_notification_claims(uuid[], uuid, text)',
    'EXECUTE'),
  'anon cannot execute release_notification_claims'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.release_notification_claims(uuid[], uuid, text)', 'EXECUTE'),
  'service_role can execute release_notification_claims'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.outbox_connection_break_limit()', 'EXECUTE'),
  'authenticated cannot execute outbox_connection_break_limit'
);

select * from finish();
rollback;
