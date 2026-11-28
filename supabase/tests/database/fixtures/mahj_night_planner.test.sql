begin;
set local search_path to extensions, public;
select plan(18);

insert into auth.users (id, email, email_confirmed_at) values
  ('aaaaaaaa-0000-0000-0000-00000000e201', 'planner-host@example.com', now()),
  ('bbbbbbbb-0000-0000-0000-00000000e202', 'planner-other@example.com', now());

create temp table night (club_id uuid, event_id uuid, link_token text) on commit drop;
grant all on night to authenticated, service_role;
create temp table secrets (email text, secret text) on commit drop;
grant all on secrets to service_role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000e201", "role": "authenticated"}';

insert into night
select (r->>'club_id')::uuid, (r->>'event_id')::uuid, r->>'link_token'
from public.create_mahj_night(
  'Planner Night', current_date + 7, '19:00', 180, '1 Elm St', 'Duluth', 2, 'jade', true,
  '', 'America/New_York', 3, 'host_choice', '  Bring $5 for pizza  ') r;

reset role;

select is(
  (select host_sets || '|' || money_norm::text || '|' || money_note
     from public.events where id = (select event_id from night)),
  '3|host_choice|Bring $5 for pizza', 'the night keeps the host''s sets and money choice');

set local role service_role;

-- Two tables, eight seats. The host takes one.
select is(
  (select r ->> 'status' from public.submit_rsvp(
     (select link_token from night), 'Tess Teacher', 'tess@example.com', 'going',
     true, true, true, true, '1.1.1.1') r),
  'going', 'a guest can RSVP as a teacher bringing a set and a card');
select is(
  (select is_beginner::text || '|' || can_teach::text from public.event_rsvps where email = 'tess@example.com'),
  'false|true', '"new" and "can teach" are never both stored');

select lives_ok(
  $$select public.submit_rsvp((select link_token from night), 'Nia New', 'nia@example.com', 'going', true, false, false, false, '1.1.1.2');
    select public.submit_rsvp((select link_token from night), 'Pat Played', 'pat@example.com', 'going', false, false, true, false, '1.1.1.3');
    select public.submit_rsvp((select link_token from night), 'May Be', 'may@example.com', 'maybe', false, false, false, false, '1.1.1.4')$$,
  'more guests RSVP');
insert into secrets select email, rsvp_secret from public.event_rsvps
 where event_id = (select event_id from night);

select is(
  jsonb_array_length(public.event_page((select link_token from night)) -> '_seating' -> 'guests'),
  3, 'the seating input lists every guest who said yes');
select is(
  public.event_page((select link_token from night)) -> '_seating' -> 'capacities',
  '[4, 4]'::jsonb, 'and each table''s seats');
select is(
  public.event_page((select link_token from night)) ->> 'money_note',
  'Bring $5 for pizza', 'everyone sees the money note');
select ok(
  not (public.event_page((select link_token from night)) ? 'guest_sets'),
  'only the host sees the set count');
select is(
  (select p ->> 'guest_sets' || '|' || (p ->> 'card_count') || '|' || (p ->> 'teacher_count')
     from (select public.event_page((select link_token from night), null,
             'aaaaaaaa-0000-0000-0000-00000000e201') p) x),
  '2|1|1', 'the host sees sets from guests, cards and teachers');

-- Fill the night: host + Tess + Nia + Pat = 4 of 8; four more fill it.
select lives_ok(
  $$select public.submit_rsvp((select link_token from night), 'G1', 'g1@example.com', 'going', false, false, false, false, '2.2.2.1');
    select public.submit_rsvp((select link_token from night), 'G2', 'g2@example.com', 'going', false, false, false, false, '2.2.2.2');
    select public.submit_rsvp((select link_token from night), 'G3', 'g3@example.com', 'going', false, false, false, false, '2.2.2.3');
    select public.submit_rsvp((select link_token from night), 'G4', 'g4@example.com', 'going', false, false, false, false, '2.2.2.4')$$,
  'the night fills');
select is(
  (select r ->> 'status' from public.submit_rsvp(
     (select link_token from night), 'May Be', 'may@example.com', 'going', false, false, false, false, '1.1.1.4',
     (select secret from secrets where email = 'may@example.com')) r),
  'waitlist', 'a maybe who asks for a seat on a full night is waitlisted');

-- Pat drops out; a seat opens; the waitlisted guest claims it.
select lives_ok(
  $$select public.submit_rsvp((select link_token from night), 'Pat Played', 'pat@example.com', 'no', false, false, false, false, '1.1.1.3',
      (select secret from secrets where email = 'pat@example.com'))$$,
  'a guest who said yes can drop out');
select is(
  (select r ->> 'status' from public.submit_rsvp(
     (select link_token from night), 'May Be', 'may@example.com', 'going', false, false, false, false, '1.1.1.4',
     (select secret from secrets where email = 'may@example.com')) r),
  'going', 'the open seat goes to whoever claims it first');

-- Moving guests: host only, a real table, yeses only.
reset role;
create temp table ids on commit drop as
  select email, id from public.event_rsvps where event_id = (select event_id from night);
grant all on ids to authenticated;
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000e202", "role": "authenticated"}';
select throws_ok(
  $$select public.set_rsvp_table((select id from ids where email = 'nia@example.com'), 2)$$,
  '42501', null, 'someone else cannot move a guest');

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000e201", "role": "authenticated"}';
select lives_ok(
  $$select public.set_rsvp_table((select id from ids where email = 'nia@example.com'), 2)$$,
  'the host can move a guest to table 2');
select throws_ok(
  $$select public.set_rsvp_table((select id from ids where email = 'nia@example.com'), 3)$$,
  '23514', null, 'but not to a table that doesn''t exist');
select throws_ok(
  $$select public.set_rsvp_table((select id from ids where email = 'pat@example.com'), 1)$$,
  '23514', null, 'and only a guest who said yes has a table');

reset role;
select is(
  (select table_number from public.event_rsvps where email = 'nia@example.com'),
  2, 'the move is kept');

select * from finish();
rollback;
