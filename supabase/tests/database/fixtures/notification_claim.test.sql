begin;
set local search_path to extensions, public;

select plan(10);

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

select * from finish();
rollback;
