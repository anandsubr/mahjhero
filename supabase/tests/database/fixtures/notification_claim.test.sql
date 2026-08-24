begin;
set local search_path to extensions, public;

select plan(39);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

update public.profiles set display_name = 'Alice', timezone = 'America/New_York'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Bob', timezone = 'America/New_York'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member');

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

insert into public.event_tables
  (id, event_id, club_id, label, skill_tier, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 2', 'beginner', 4, 1);

insert into public.booking_groups (id, event_id, club_id, created_by, status)
  values ('9409409e-0000-0000-0000-000000000001',
          'e1e1e1e1-0000-0000-0000-000000000001',
          'c1c1c1c1-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed');
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   status)
  values ('b00c1234-0000-0000-0000-000000000001',
          '9409409e-0000-0000-0000-000000000001',
          'e1e1e1e1-0000-0000-0000-000000000001',
          'c1c1c1c1-0000-0000-0000-000000000001',
          '7ab1e000-0000-0000-0000-000000000001',
          'bbbbbbbb-0000-0000-0000-000000000002',
          'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed');

-- A booking-shaped message: the payload names a booking and nothing else,
-- which is exactly what plan 4 writes.
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'booked_by_friend',
   jsonb_build_object('booking_id', 'b00c1234-0000-0000-0000-000000000001',
                      'booked_by', 'aaaaaaaa-0000-0000-0000-000000000001'),
   'ctx:1');

/*
 * A club-wide broadcast: no event, no booking, and the payload names
 * neither -- exactly the shape send_broadcast (20260826030000) writes for
 * a roster-wide send. This is what makes every LEFT JOIN in
 * outbox_render_context except the broadcasts one load-bearing: the
 * events, bookings, event_tables and actor-profiles joins all have
 * nothing to match here, so if any one of them were an INNER JOIN this
 * row would vanish from the function's output entirely -- which the
 * assertions below on recipient_email/broadcast_subject/broadcast_body
 * (values that must survive regardless) would catch, since a vanished row
 * makes every column of it read back as null, not only the ones that were
 * genuinely null to begin with.
 */
insert into public.broadcasts
  (id, club_id, event_id, author_id, subject, body) values
  ('b6b6b6b6-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'aaaaaaaa-0000-0000-0000-000000000001',
   'Court closed this week',
   'Sorry all, the hall is unavailable Tuesday -- see you the week after.');

insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   null,
   'broadcast',
   jsonb_build_object('broadcast_id', 'b6b6b6b6-0000-0000-0000-000000000001'),
   'ctx:2');

/*
 * An event_cancelled row shaped like 20260825042000's series-shortening
 * insert, not 20260825040000's cancel_event: event_id = null on purpose,
 * with the dropped occurrence's own id and start time carried in the
 * payload because the occurrence (and the booking this payload names) is
 * gone by the time this row is ever read. booking_id points at nothing
 * that exists -- the cascade delete already took it -- which is the real
 * shape, not a fixture shortcut.
 */
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   null,
   'event_cancelled',
   jsonb_build_object('booking_id', gen_random_uuid(),
                      'series_id', gen_random_uuid(),
                      'event_id', gen_random_uuid(),
                      'starts_at', '2026-09-03T18:00:00+00:00'),
   'ctx:3');

/*
 * An event_cancelled row shaped like cancel_event's own insert
 * (20260825040000): payload names only the booking, no actor key at all --
 * unlike booking_cancelled_by_host, which duplicates its actor into the
 * payload. The booking it names is real and its cancelled_by is set, the
 * way cancel_event itself sets it, so actor_name has to be recovered
 * through the booking join rather than the payload.
 */
update public.bookings set cancelled_by = 'aaaaaaaa-0000-0000-0000-000000000001'
 where id = 'b00c1234-0000-0000-0000-000000000001';

insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000004',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'event_cancelled',
   jsonb_build_object('booking_id', 'b00c1234-0000-0000-0000-000000000001'),
   'ctx:4');

/*
 * A waitlist_promoted row whose booking has SINCE been cancelled. This is
 * the race the actor fallback has to stay out of: bookings.cancelled_by is
 * read live at render time, not snapshotted when the row was queued, and
 * a promoted member's outbox row can sit for a while (lease, backoff,
 * quiet-hour holds) before it drains. Reuses the same booking as the row
 * above -- its cancelled_by is already set to Alice -- specifically to
 * prove the fallback does NOT reach across kinds: the payload here is
 * exactly what waitlist_promoted (20260825010000, 20260825100000) and
 * unseated (20260825040000) both write, {'booking_id', ...} with no actor
 * key, so an unscoped fallback would misname Alice as the person who
 * promoted Bob off the waitlist. She didn't -- she cancelled the booking,
 * unrelated to the promotion this row is about.
 */
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-000000000005',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'waitlist_promoted',
   jsonb_build_object('booking_id', 'b00c1234-0000-0000-0000-000000000001',
                      'event_table_id', '7ab1e000-0000-0000-0000-000000000001'),
   'ctx:5');

-- ---------------------------------------------------------------------
-- resolve_notify_channel. Every branch is email today; the shape is what
-- the later push plan changes.
-- ---------------------------------------------------------------------
select is(
  public.resolve_notify_channel('bbbbbbbb-0000-0000-0000-000000000002'),
  'email',
  'a member defaulting to both resolves to email'
);

update public.profiles set notify_channel = 'push'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select is(
  public.resolve_notify_channel('bbbbbbbb-0000-0000-0000-000000000002'),
  'email',
  'push with no registered token resolves to email'
);

insert into public.push_tokens (profile_id, token, platform)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'ExponentPushToken[x]',
          'ios');
select is(
  public.resolve_notify_channel('bbbbbbbb-0000-0000-0000-000000000002'),
  'email',
  'push with a token still resolves to email while push is dark'
);
delete from public.push_tokens;
update public.profiles set notify_channel = 'both'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

select is(
  public.resolve_notify_channel('00000000-0000-0000-0000-0000000000ff'),
  null,
  'an unknown profile resolves to nothing at all'
);

-- ---------------------------------------------------------------------
-- outbox_render_context. The point of the whole task: an id-only payload
-- comes back as something a template can read.
-- ---------------------------------------------------------------------
select is(
  (select recipient_email from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'bob@example.com',
  'the address is fetched from auth.users, the only place it exists'
);
select is(
  (select recipient_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Bob',
  'the recipient is named'
);
select is(
  (select club_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Riverside',
  'the club is named'
);
select is(
  (select event_title from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Tuesday night',
  'the event is named'
);

-- The table label is reached THROUGH the booking. Nothing in this payload
-- mentions a table, and an email that cannot say which table is most of
-- the value of the message gone.
select is(
  (select table_label from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Table 2',
  'the table is found through the booking the payload names'
);

select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000001'::uuid])),
  'Alice',
  'the person who booked the seat is named'
);

/*
 * A broadcast has no event, no booking and no per-recipient actor -- every
 * LEFT JOIN except broadcasts finds nothing to match. recipient_email and
 * the broadcast fields are asserted as non-null canaries: a stray INNER
 * JOIN on events, bookings, event_tables or the actor-profiles join would
 * drop this row from the function's result set entirely, which would read
 * back as every column -- canaries included -- coming back null, not only
 * the ones this test expects to be null. A test that only ever expects
 * null here could not tell "the row is gone" from "the row is present and
 * this field is genuinely empty".
 */
select is(
  (select recipient_email from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000002'::uuid])),
  'bob@example.com',
  'a broadcast row survives at all -- the canary the null checks below rely on'
);
select is(
  (select event_id from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000002'::uuid])),
  null::uuid,
  'a club-wide broadcast has no event'
);
select is(
  (select event_title from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000002'::uuid])),
  null::text,
  'no event means no title'
);
select is(
  (select event_starts_at from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000002'::uuid])),
  null::timestamptz,
  'no event means no start time'
);
select is(
  (select table_label from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000002'::uuid])),
  null::text,
  'a broadcast names no table, through a booking or otherwise'
);
select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000002'::uuid])),
  null::text,
  'a broadcast has no per-recipient actor'
);
select is(
  (select broadcast_subject from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000002'::uuid])),
  'Court closed this week',
  'the subject is found through the broadcast the payload names'
);
select is(
  (select broadcast_body from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000002'::uuid])),
  'Sorry all, the hall is unavailable Tuesday -- see you the week after.',
  'so is the body'
);

-- A dropped occurrence's start time is recovered from the payload
-- (20260825042000), because the row this join would otherwise use is
-- gone. event_title is NOT recovered the same way -- there is nothing in
-- that payload to recover it from, and the template layer already
-- degrades to "A game" / "the game" for a null title.
select is(
  (select event_starts_at from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000003'::uuid])),
  '2026-09-03T18:00:00+00:00'::timestamptz,
  'a dropped occurrence''s start time is recovered from the payload'
);
select is(
  (select event_title from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000003'::uuid])),
  null::text,
  'the title is not -- the payload never captured one'
);

-- cancel_event's own event_cancelled rows carry no actor key in the
-- payload, unlike booking_cancelled_by_host. The host who cancelled is
-- recovered through the booking it already names.
select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000004'::uuid])),
  'Alice',
  'the host who cancelled the booking is named via bookings.cancelled_by'
);

-- The fallback must not reach across kinds: waitlist_promoted's payload is
-- the same {'booking_id', ...} shape event_cancelled's fallback targets,
-- and the booking it names has since been cancelled by Alice -- but Alice
-- did not promote anyone, so actor_name has to stay null here rather than
-- borrowing bookings.cancelled_by the way event_cancelled does.
select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-000000000005'::uuid])),
  null::text,
  'a waitlist_promoted row does not borrow the cancelling host as its actor'
);

-- ---------------------------------------------------------------------
-- Claiming. Each scenario clears the outbox first: these assertions are
-- about which rows come back, and a leftover row from the previous
-- scenario makes every count meaningless. The first scenario keeps
-- rather than deletes the very first row inserted above (ctx:1,
-- id 0b0b0b0b-...001) instead of deleting everything and reinserting an
-- equivalent -- render_context's assertions already ran against it, and
-- the row is otherwise identical to what a clean insert would produce.
-- ---------------------------------------------------------------------
delete from public.notification_outbox
 where id <> '0b0b0b0b-0000-0000-0000-000000000001';
update public.profiles set quiet_hours_enabled = false;

select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'a due row is claimed'
);
select is(
  (select attempts from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  1,
  'claiming counts as an attempt, before anything is sent'
);
-- The lease. The Edge Function sends after this transaction commits, so
-- nothing holds a row lock across the send; this is what stops a second
-- invocation a few seconds later sending the same message again.
select ok(
  (select next_attempt_at > now() + interval '4 minutes'
     from public.notification_outbox
    where id = '0b0b0b0b-0000-0000-0000-000000000001'),
  'a claimed row is leased five minutes into the future'
);
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  0,
  'a leased row is not claimed again'
);

-- Mute. Applies to need_a_fourth and to nothing else.
delete from public.notification_outbox;
update public.profiles set mute_need_a_fourth = true
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'need_a_fourth', '{}'::jsonb, 'claim:muted'),
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'claim:offer');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'a muted member hears about a seat but not about a fourth'
);
select is(
  (select kind::text from public.notification_outbox
    where attempts = 1),
  'promotion_offer',
  'the one that got through is the seat offer, not the muted fourth'
);
update public.profiles set mute_need_a_fourth = false;

-- Quiet hours. The window is built around now() so the assertion does not
-- depend on what time the suite runs.
delete from public.notification_outbox;
update public.profiles
   set quiet_hours_enabled = true,
       quiet_hours_start =
         ((now() at time zone 'America/New_York') - interval '1 hour')::time,
       quiet_hours_end =
         ((now() at time zone 'America/New_York') + interval '1 hour')::time
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'broadcast', '{}'::jsonb, 'claim:quiet-broadcast'),
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'claim:quiet-offer');

select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'quiet hours hold a broadcast and let an offer through'
);
select is(
  (select kind::text from public.notification_outbox
    where attempts = 1),
  'promotion_offer',
  'the one that got through is the one with a two-hour fuse'
);
-- Held, not failed. The distinction matters: a failed row is retried on a
-- backoff and eventually dies, a held row simply is not due yet.
select ok(
  (select failed_at is null and expired_at is null and attempts = 0
     from public.notification_outbox
    where dedupe_key = 'claim:quiet-broadcast'),
  'a held broadcast is untouched, not failed'
);

-- The reminder exemption. A game starting inside the quiet window must be
-- reminded about during it, or a club that plays at 9am gets its two-hour
-- reminder at 08:00, after it stopped being useful.
delete from public.notification_outbox;
update public.events
   set starts_at = now() + interval '30 minutes',
       ends_at   = now() + interval '3 hours 30 minutes'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'event_reminder', jsonb_build_object('offset_minutes', 120),
   'claim:exempt-reminder');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  1,
  'a reminder for a game inside the quiet window is exempt'
);

-- ... and a reminder for a game well outside it is not. Offset by whole
-- days plus twelve hours, not whole days alone: in_quiet_window compares
-- local time-of-day only (quiet hours recur nightly, not on one date), and
-- a plain `+ interval 'N days'` preserves starts_at's time-of-day exactly
-- -- landing right back inside the window this fixture built around now(),
-- no matter how many days out. The extra twelve hours puts the event on
-- the opposite side of the clock from the window instead.
delete from public.notification_outbox;
update public.events
   set starts_at = now() + interval '3 days 12 hours',
       ends_at   = now() + interval '3 days 15 hours'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'event_reminder', jsonb_build_object('offset_minutes', 1440),
   'claim:held-reminder');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  0,
  'a reminder for a game three days out waits for morning'
);
update public.profiles set quiet_hours_enabled = false;

-- Staleness. The game has started; nothing about it is worth saying.
delete from public.notification_outbox;
update public.events
   set starts_at = now() - interval '1 hour',
       ends_at   = now() + interval '2 hours'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'event_reminder', '{}'::jsonb, 'claim:stale');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  0,
  'a message about a game already underway is not sent'
);
select ok(
  (select expired_at is not null from public.notification_outbox
    where dedupe_key = 'claim:stale'),
  'it is marked expired rather than left to rot in the queue'
);

-- Nobody to send to.
delete from public.notification_outbox;
update public.events
   set starts_at = now() + interval '2 days',
       ends_at   = now() + interval '2 days 3 hours'
 where id = 'e1e1e1e1-0000-0000-0000-000000000001';
update auth.users set email = null
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'promotion_offer', '{}'::jsonb, 'claim:no-address');
select is(
  (select count(*)::int from public.claim_notification_batch(50)),
  0,
  'a recipient with no address is not claimed'
);
select ok(
  (select expired_at is not null from public.notification_outbox
    where dedupe_key = 'claim:no-address'),
  'and is expired, not retried five times against nothing'
);
update auth.users set email = 'bob@example.com'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- The limit is honoured, so one enormous backlog cannot become one
-- enormous function invocation.
delete from public.notification_outbox;
insert into public.notification_outbox
  (recipient_id, club_id, event_id, kind, payload, dedupe_key)
select 'bbbbbbbb-0000-0000-0000-000000000002',
       'c1c1c1c1-0000-0000-0000-000000000001',
       'e1e1e1e1-0000-0000-0000-000000000001',
       'promotion_offer', '{}'::jsonb, 'claim:bulk:' || i::text
  from generate_series(1, 10) i;
select is(
  (select count(*)::int from public.claim_notification_batch(4)),
  4,
  'the batch limit is honoured'
);
select is(
  (select count(*)::int from public.notification_outbox where attempts = 0),
  6,
  'and the rest are left untouched for the next tick'
);

select * from finish();
rollback;
