begin;
set local search_path to extensions, public;

select plan(21);

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

select * from finish();
rollback;
