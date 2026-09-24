begin;
set local search_path to extensions, public;
select plan(4);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000fe01', 'rn-alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000fe02', 'rn-bob@example.com');

update public.profiles set display_name = 'Alice A.'
 where id = 'aaaaaaaa-0000-0000-0000-00000000fe01';
update public.profiles set display_name = 'Bob B.'
 where id = 'bbbbbbbb-0000-0000-0000-00000000fe02';

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000fe01', 'Render Club', 'render-club',
   'aaaaaaaa-0000-0000-0000-00000000fe01');

-- Alice sent the invite; Bob is the invitee. Rows are shaped exactly as
-- commit_booking / accept_booking_invite / withdraw_booking_invite /
-- cancel_booking write them (20260924102000, 20260924103000).
insert into public.notification_outbox
  (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b0b0b0b-0000-0000-0000-00000000fe01',
   'aaaaaaaa-0000-0000-0000-00000000fe01',
   'c1c1c1c1-0000-0000-0000-00000000fe01', null, 'booking_invite_accepted',
   jsonb_build_object('booking_id', 'b00c0000-0000-0000-0000-00000000fe01',
                      'accepted_by', 'bbbbbbbb-0000-0000-0000-00000000fe02',
                      'waitlisted', false),
   'test:booking_invite_accepted'),
  ('0b0b0b0b-0000-0000-0000-00000000fe02',
   'bbbbbbbb-0000-0000-0000-00000000fe02',
   'c1c1c1c1-0000-0000-0000-00000000fe01', null, 'booking_invited',
   jsonb_build_object('booking_id', 'b00c0000-0000-0000-0000-00000000fe01',
                      'booked_by', 'aaaaaaaa-0000-0000-0000-00000000fe01',
                      'holds_seat', true),
   'test:booking_invited'),
  ('0b0b0b0b-0000-0000-0000-00000000fe03',
   'bbbbbbbb-0000-0000-0000-00000000fe02',
   'c1c1c1c1-0000-0000-0000-00000000fe01', null, 'booking_invite_withdrawn',
   jsonb_build_object('booking_id', 'b00c0000-0000-0000-0000-00000000fe01',
                      'cancelled_by', 'aaaaaaaa-0000-0000-0000-00000000fe01'),
   'test:booking_invite_withdrawn'),
  ('0b0b0b0b-0000-0000-0000-00000000fe04',
   'aaaaaaaa-0000-0000-0000-00000000fe01',
   'c1c1c1c1-0000-0000-0000-00000000fe01', null, 'booking_cancelled_by_member',
   jsonb_build_object('booking_id', 'b00c0000-0000-0000-0000-00000000fe01',
                      'cancelled_by', 'bbbbbbbb-0000-0000-0000-00000000fe02'),
   'test:booking_cancelled_by_member');

select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-00000000fe01']::uuid[])),
  'Bob B.',
  'an accepted invite names the invitee who accepted');
select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-00000000fe02']::uuid[])),
  'Alice A.',
  'an invite names its sender');
select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-00000000fe03']::uuid[])),
  'Alice A.',
  'a withdrawn invite names who withdrew it');
select is(
  (select actor_name from public.outbox_render_context(
     array['0b0b0b0b-0000-0000-0000-00000000fe04']::uuid[])),
  'Bob B.',
  'a member-cancel names the member who left');

select * from finish();
rollback;
