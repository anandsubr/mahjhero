begin;
set local search_path to extensions, public;

select plan(44);

/*
 * delete_account_data (20261122100000) followed by the auth user's delete --
 * the two halves of the delete-account edge function.
 *
 * Tara is the person leaving. She hosts Riverside alone (Ben, Cara and Dev
 * are plain members, Ben the longest-tenured of them) and is the only member
 * of Solo. She holds a seat at a full Thursday game with Dev waiting, booked
 * Cara's seat beside her, created the venue and the game, recorded a round,
 * started a group thread, posted on the board (with Ben replying), replied
 * to Ben's post, announced, and uploaded a photo.
 */
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'tara@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'ben@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'cara@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dev@example.com');

update public.profiles set display_name = 'Tara'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Ben'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set display_name = 'Cara'
 where id = 'cccccccc-0000-0000-0000-000000000003';
update public.profiles set display_name = 'Dev'
 where id = 'dddddddd-0000-0000-0000-000000000004';

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Solo', 'solo',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status, joined_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active',
   now() - interval '30 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active',
   now() - interval '20 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member', 'active',
   now() - interval '10 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004', 'member', 'active',
   now() - interval '5 days'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active',
   now() - interval '30 days');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.events
  (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Thursday game',
   '11111111-0000-0000-0000-000000000001',
   now() + interval '7 days', now() + interval '7 days 3 hours',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e0e0e0e0-0000-0000-0000-000000000000',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Last week',
   '11111111-0000-0000-0000-000000000001',
   now() - interval '7 days', now() - interval '7 days' + interval '3 hours',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.event_tables
  (id, event_id, club_id, label, capacity, position) values
  ('7ab1e000-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 2, 1),
  ('7ab1e000-0000-0000-0000-000000000000',
   'e0e0e0e0-0000-0000-0000-000000000000',
   'c1c1c1c1-0000-0000-0000-000000000001', 'Table 1', 4, 1);

-- Tara books herself and Cara: two seats, the table is full.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001');
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by,
   created_at)
values
  ('b00c0000-0000-0000-0000-000000000001',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '2 days'),
  ('b00c0000-0000-0000-0000-000000000003',
   '9909aaaa-0000-0000-0000-000000000001',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '2 days');

-- Dev is waiting.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id, status,
   waitlisted_at) values
  ('9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   '7ab1e000-0000-0000-0000-000000000001', 'waitlisted', now());
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status) values
  ('b00c0000-0000-0000-0000-000000000004',
   '9909aaaa-0000-0000-0000-000000000004',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000004', 'waitlisted');

-- Tara invited Ben too, without holding him a seat.
insert into public.booking_groups
  (id, event_id, club_id, created_by) values
  ('9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.bookings
  (id, group_id, event_id, club_id, profile_id, booked_by, status,
   invite_holds_seat) values
  ('b00c0000-0000-0000-0000-000000000005',
   '9909aaaa-0000-0000-0000-000000000005',
   'e1e1e1e1-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 'invited', false);

-- Tara played last week, and recorded Cara's win.
insert into public.booking_groups
  (id, event_id, club_id, created_by, preferred_table_id) values
  ('9909aaaa-0000-0000-0000-000000000000',
   'e0e0e0e0-0000-0000-0000-000000000000',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000000');
insert into public.bookings
  (id, group_id, event_id, club_id, event_table_id, profile_id, booked_by)
values ('b00c0000-0000-0000-0000-000000000000',
        '9909aaaa-0000-0000-0000-000000000000',
        'e0e0e0e0-0000-0000-0000-000000000000',
        'c1c1c1c1-0000-0000-0000-000000000001',
        '7ab1e000-0000-0000-0000-000000000000',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.table_rounds
  (id, event_table_id, event_id, club_id, winner_profile_id, points,
   recorded_by) values
  ('40000000-0000-0000-0000-000000000001',
   '7ab1e000-0000-0000-0000-000000000000',
   'e0e0e0e0-0000-0000-0000-000000000000',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 25,
   'aaaaaaaa-0000-0000-0000-000000000001');

-- Riverside's board. p1 is Tara's with Ben's reply r1 (each with a photo);
-- p2 is Ben's with Tara's reply r2.
insert into public.message_threads (id, club_id, created_by) values
  ('11110000-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.messages
  (id, thread_id, author_id, body, created_at, root_id, reply_count,
   last_reply_at) values
  ('a1000000-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Tara''s post',
   now() - interval '3 days', null, 1, now() - interval '2 days'),
  ('a2000000-0000-0000-0000-000000000002',
   '11110000-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Ben''s post',
   now() - interval '4 days', null, 1, now() - interval '1 day');
insert into public.messages
  (id, thread_id, author_id, body, created_at, root_id) values
  ('a1100000-0000-0000-0000-000000000011',
   '11110000-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Ben replies to Tara',
   now() - interval '2 days', 'a1000000-0000-0000-0000-000000000001'),
  ('a2200000-0000-0000-0000-000000000022',
   '11110000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Tara replies to Ben',
   now() - interval '1 day', 'a2000000-0000-0000-0000-000000000002');
insert into public.message_attachments
  (message_id, thread_id, storage_path, width, height, sort_order) values
  ('a1000000-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000001/p1.jpg', 800, 600, 0),
  ('a1100000-0000-0000-0000-000000000011',
   '11110000-0000-0000-0000-000000000001',
   '11110000-0000-0000-0000-000000000001/r1.jpg', 800, 600, 0);

-- A group thread Tara started, adding Ben. Ben spoke first, Tara last.
insert into public.message_threads (id, title, created_by, last_message_at) values
  ('33330000-0000-0000-0000-000000000003', 'Thursday four',
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 hour');
insert into public.thread_members (thread_id, profile_id, added_by) values
  ('33330000-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', null),
  ('33330000-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.messages (id, thread_id, author_id, body, created_at) values
  ('a3000000-0000-0000-0000-000000000003',
   '33330000-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000002', 'Ben here',
   now() - interval '2 hours'),
  ('a4000000-0000-0000-0000-000000000004',
   '33330000-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Tara here',
   now() - interval '1 hour');

insert into public.broadcasts (id, club_id, author_id, subject, body) values
  ('b6b6b6b6-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Heads up', 'Bring tiles');

insert into public.club_media
  (club_id, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by)
values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
   'c1c1c1c1-0000-0000-0000-000000000001/photos/tara.jpg', 'tara.jpg',
   'image/jpeg', 100, 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.archived_messages
  (id, thread_id, author_id, body, is_announcement, created_at, reply_count,
   archived_at)
values
  ('a9000000-0000-0000-0000-000000000009',
   '11110000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'Old chat', false,
   now() - interval '60 days', 0, now() - interval '30 days');

-- Every row anywhere that still names a profile id: each FK column that
-- references profiles or auth.users, plus archived_messages.author_id,
-- which has no FK.
create function pg_temp.rows_naming(target uuid) returns text
language plpgsql as $$
declare
  fk  record;
  n   int;
  out text := '';
begin
  for fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f'
       and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
    union all
    select 'public.archived_messages'::regclass, 'author_id'
  loop
    execute format('select count(*) from %s where %I = $1', fk.tbl, fk.col)
      into n using target;
    if n > 0 then
      out := out || fk.tbl::text || '.' || fk.col || '=' || n || ' ';
    end if;
  end loop;
  return trim(out);
end;
$$;

-- ---------------------------------------------------------------------
-- Who may call it.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select throws_ok(
  $$select * from public.delete_account_data('aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a signed-in member cannot run account deletion, not even on themselves');

reset role;
select ok(
  not has_function_privilege('authenticated',
    'public.delete_account_data(uuid)', 'EXECUTE'),
  'authenticated has no EXECUTE on delete_account_data');
select ok(
  has_function_privilege('service_role',
    'public.delete_account_data(uuid)', 'EXECUTE'),
  'service_role has EXECUTE on delete_account_data');

set local role service_role;
set local request.jwt.claims = '{"role": "service_role"}';

select throws_ok(
  $$select * from public.delete_account_data(null)$$,
  '22023',
  'no such account',
  'a null target is refused');

-- ---------------------------------------------------------------------
-- The run, as the edge function calls it.
-- ---------------------------------------------------------------------
create temp table removed_paths as
  select * from public.delete_account_data('aaaaaaaa-0000-0000-0000-000000000001');

select is(
  current_setting('request.jwt.claims', true),
  '{"role": "service_role"}',
  'the caller''s claims are put back afterwards');

reset role;

select bag_eq(
  $$select bucket, path from removed_paths$$,
  $$values
      ('message-images', '11110000-0000-0000-0000-000000000001/p1.jpg'),
      ('message-images', '11110000-0000-0000-0000-000000000001/r1.jpg'),
      ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/photos/tara.jpg')$$,
  'returns every storage object to remove: her attachment, the reply''s under her post, her media');

-- Review Focus 2: her seat at the full game goes to Dev, as a cancel would.
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000004'),
  'confirmed',
  'the member waiting for the full game is seated');
select is(
  (select event_table_id from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000004'),
  '7ab1e000-0000-0000-0000-000000000001'::uuid,
  'at the table her seat came free at');
select is(
  (select count(*)::int from public.notification_outbox
    where recipient_id = 'dddddddd-0000-0000-0000-000000000004'
      and kind = 'waitlist_promoted'),
  1,
  'and is told, exactly as a normal cancel tells them');
select is(
  (select count(*)::int from public.bookings
    where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'none of her bookings remain, past or future');
select is(
  (select count(*)::int from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000000'),
  0,
  'a group left with no bookings at all is removed');
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000003'),
  'confirmed',
  'the seat she booked for Cara is still Cara''s');
select is(
  (select created_by from public.booking_groups
    where id = '9909aaaa-0000-0000-0000-000000000001'),
  'cccccccc-0000-0000-0000-000000000003'::uuid,
  'and the group she made passes to the person still in it, who can answer its offers');

-- Review Focus 3: her post and the replies under it are gone; no orphan.
select is(
  (select count(*)::int from public.messages
    where author_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'every message she wrote is gone');
select is(
  (select count(*)::int from public.messages
    where id = 'a1100000-0000-0000-0000-000000000011'),
  0,
  'the reply under her post went with it');
select is(
  (select count(*)::int from public.message_attachments
    where thread_id = '11110000-0000-0000-0000-000000000001'),
  0,
  'and so did their attachment rows');
select is(
  (select array_agg(id) from public.messages
    where thread_id = '11110000-0000-0000-0000-000000000001'
      and root_id is null),
  array['a2000000-0000-0000-0000-000000000002'::uuid],
  'the board has only Ben''s post as a top-level post -- no orphan surfaced');
select is(
  (select reply_count from public.messages
    where id = 'a2000000-0000-0000-0000-000000000002'),
  0,
  'Ben''s post no longer counts her reply');
select is(
  (select last_reply_at from public.messages
    where id = 'a2000000-0000-0000-0000-000000000002'),
  null,
  'nor sorts by it');
select is(
  (select last_message_at from public.message_threads
    where id = '33330000-0000-0000-0000-000000000003'),
  now() - interval '2 hours',
  'a thread she spoke in last sorts by what is left in it');
select is(
  (select count(*)::int from public.broadcasts
    where author_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'her announcements are gone');
select is(
  (select count(*)::int from public.club_media
    where uploaded_by = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'her photos and files are gone');
select is(
  (select count(*)::int from public.archived_messages
    where author_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'and so is her archived chat');

-- ---------------------------------------------------------------------
-- The auth user's delete. (auth.admin.deleteUser runs it as
-- supabase_auth_admin, which this runner cannot assume; the FK actions it
-- sets off run as each table's owner either way.)
-- ---------------------------------------------------------------------
select lives_ok(
  $$delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'the auth user can then be deleted');

select is(
  pg_temp.rows_naming('aaaaaaaa-0000-0000-0000-000000000001'),
  '',
  'no row anywhere still names her');

-- Review Focus 1.
select is(
  (select role::text from public.club_members
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
      and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'host',
  'the longest-tenured member of the club she hosted becomes its host');
select is(
  (select count(*)::int from public.club_members
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001' and role = 'host'),
  1,
  'and only that one');
select is(
  (select count(*)::int from public.clubs
    where id = 'c2c2c2c2-0000-0000-0000-000000000002'),
  0,
  'a club she was the only member of is deleted');
select is(
  (select created_by from public.clubs
    where id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  null,
  'the surviving club no longer names her as creator');

-- What survives, anonymised.
select is(
  (select created_by from public.events
    where id = 'e1e1e1e1-0000-0000-0000-000000000001'),
  null, 'the game she created survives without a creator');
select is(
  (select created_by from public.venues
    where id = '11111111-0000-0000-0000-000000000001'),
  null, 'the venue she added survives without a creator');
select is(
  (select booked_by from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000003'),
  null, 'Cara''s seat survives without a booker');
select is(
  (select recorded_by from public.table_rounds
    where id = '40000000-0000-0000-0000-000000000001'),
  null, 'the round she recorded survives without a recorder');
select is(
  (select winner_profile_id from public.table_rounds
    where id = '40000000-0000-0000-0000-000000000001'),
  'cccccccc-0000-0000-0000-000000000003'::uuid, 'and still names its winner');
select is(
  (select created_by from public.message_threads
    where id = '33330000-0000-0000-0000-000000000003'),
  null, 'the group thread she started survives without a creator');
select is(
  (select added_by from public.thread_members
    where thread_id = '33330000-0000-0000-0000-000000000003'
      and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  null, 'and Ben is still in it, added by nobody');
select is(
  (select created_by from public.message_threads
    where id = '11110000-0000-0000-0000-000000000001'),
  null, 'the club board survives without a creator');

-- A seat booked by somebody who has since left still reads and still
-- answers like any other seat booked for you.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select is(
  (select count(*)::int from public.event_seating('e1e1e1e1-0000-0000-0000-000000000001')
    where booking_id = 'b00c0000-0000-0000-0000-000000000003'),
  1,
  'the seat still shows on the game''s seating');
select is(
  (select booked_by_name from public.event_seating('e1e1e1e1-0000-0000-0000-000000000001')
    where booking_id = 'b00c0000-0000-0000-0000-000000000003'),
  null,
  'with no booker name');
select is(
  (select count(*)::int from public.my_upcoming_bookings()
    where booking_id = 'b00c0000-0000-0000-0000-000000000003'),
  1,
  'and in Cara''s upcoming games');
select lives_ok(
  $$select public.decline_booking('b00c0000-0000-0000-0000-000000000003')$$,
  'Cara can still decline it');
reset role;
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000003'),
  'declined',
  'and it is declined');

-- An invite from somebody who has since left can still be accepted.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select lives_ok(
  $$select public.accept_booking_invite('b00c0000-0000-0000-0000-000000000005')$$,
  'Ben can still accept the invite she sent');
reset role;
select is(
  (select status::text from public.bookings
    where id = 'b00c0000-0000-0000-0000-000000000005'),
  'confirmed',
  'and, joining the queue, takes the seat Cara just gave up');

select * from finish();
rollback;
