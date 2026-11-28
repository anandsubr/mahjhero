begin;
set local search_path to extensions, public;
select plan(30);

insert into auth.users (id, email, email_confirmed_at) values
  ('aaaaaaaa-0000-0000-0000-00000000d001', 'night-host@example.com', now()),
  ('bbbbbbbb-0000-0000-0000-00000000d002', 'guest-one@example.com', now()),
  ('cccccccc-0000-0000-0000-00000000d003', 'stranger@example.com', now());

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-0000-0000-0000-00000000d001', 'Priya Shah')
on conflict (id) do update set display_name = excluded.display_name;

create temp table night (club_id uuid, event_id uuid, link_token text, code text) on commit drop;
grant all on night to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_mahj_night
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000d001", "role": "authenticated"}';

select lives_ok(
  $$insert into night
    select (r->>'club_id')::uuid, (r->>'event_id')::uuid, r->>'link_token', null
    from public.create_mahj_night(
      'Friday Mahj', current_date + 7, '19:00', 180,
      '12 Oak Lane, Suwanee, GA', 'Suwanee', 1, 'jade', true,
      'Bring snacks', 'America/Chicago') r$$,
  'a signed-in user can create a Mahj Night'
);

reset role;
update night set code = (select code from public.clubs where id = night.club_id);

select is(
  (select kind::text from public.clubs where id = (select club_id from night)),
  'event', 'its group is an event group');
select is(
  (select timezone from public.clubs where id = (select club_id from night)),
  'America/Chicago', 'the group takes the host''s timezone');
select is(
  (select event_type::text || '|' || public_area || '|' || beginners_welcome::text
     from public.events where id = (select event_id from night)),
  'mahj_night|Suwanee|true', 'the game is a Mahj Night with its area and badge');
select is(
  (select count(*)::int from public.event_tables where event_id = (select event_id from night)),
  1, 'one table of four');
select is(
  (select role::text from public.club_members
    where club_id = (select club_id from night)
      and profile_id = 'aaaaaaaa-0000-0000-0000-00000000d001'),
  'host', 'the creator hosts it');
select ok(
  length((select link_token from night)) >= 32, 'it has a long random link token');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000d001", "role": "authenticated"}';

select throws_ok(
  $$update public.clubs set link_enabled = false where id = (select club_id from night)$$,
  '42501', null, 'even the host cannot write the link columns directly');

select throws_ok(
  $$select public.event_page((select link_token from night), null, null)$$,
  '42501', null, 'a signed-in client cannot call event_page directly');

-- A guessed group code must not join a party.
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000d003", "role": "authenticated"}';
select is(
  public.join_club_by_code((select code from night)),
  null, 'a group code does not join an event group');

-- ---------------------------------------------------------------------------
-- event_page and submit_rsvp, as the edge function (service role)
-- ---------------------------------------------------------------------------
set local role service_role;

select is(
  public.event_page((select link_token from night)) ->> 'tier',
  'public', 'anyone with the link gets the public view');
select ok(
  not (public.event_page((select link_token from night)) ? 'address'),
  'the public view has no address');
select is(
  public.event_page((select link_token from night)) ->> 'host_first_name',
  'Priya', 'the public view names the host by first name');
select is(
  public.event_page('not-a-real-token-at-all-xxxxxxxx'), null,
  'an unknown token shows nothing');

create temp table rsvp (secret text) on commit drop;
grant all on rsvp to service_role;

select is(
  (select r ->> 'outcome' from public.submit_rsvp(
     (select link_token from night), 'Ana Lopez', 'Guest-One@example.com', 'going', true, '1.2.3.4') r),
  'created', 'a guest can RSVP without signing in');
insert into rsvp select rsvp_secret from public.event_rsvps where lower(email) = 'guest-one@example.com';

select is(
  public.event_page((select link_token from night), (select secret from rsvp)) ->> 'tier',
  'guest', 'the RSVP secret unlocks the guest view');
select is(
  public.event_page((select link_token from night), (select secret from rsvp)) ->> 'address',
  '12 Oak Lane, Suwanee, GA', 'the guest view has the full address');
select is(
  public.event_page((select link_token from night)) ->> 'going_count',
  '2', 'going counts the host and the yes');

select is(
  (select r ->> 'outcome' from public.submit_rsvp(
     (select link_token from night), 'Someone Else', 'guest-one@example.com', 'no', false, '5.6.7.8') r),
  'exists', 'the same email without the secret changes nothing');
select is(
  (select status::text from public.event_rsvps where lower(email) = 'guest-one@example.com'),
  'going', 'the original answer stands');

select is(
  (select r ->> 'outcome' from public.submit_rsvp(
     (select link_token from night), 'Ana Lopez', 'guest-one@example.com', 'maybe', true, '1.2.3.4',
     (select secret from rsvp)) r),
  'updated', 'with the secret, the guest can change their answer');

-- One table: four seats, host included. Ana is a maybe; three yeses fill it.
select lives_ok(
  $$select public.submit_rsvp((select link_token from night), 'B', 'b@example.com', 'going', false, '9.9.9.1');
    select public.submit_rsvp((select link_token from night), 'C', 'c@example.com', 'going', false, '9.9.9.2');
    select public.submit_rsvp((select link_token from night), 'D', 'd@example.com', 'going', false, '9.9.9.3')$$,
  'three more yeses fit at one table');
select throws_ok(
  $$select public.submit_rsvp((select link_token from night), 'E', 'e@example.com', 'going', false, '9.9.9.4')$$,
  'P0001', 'full', 'a yes past the seats is refused');

reset role;
insert into public.rsvp_attempts (club_id, client_ip)
select (select club_id from night), '6.6.6.6' from generate_series(1, 20);
set local role service_role;
select throws_ok(
  $$select public.submit_rsvp((select link_token from night), 'F', 'f@example.com', 'maybe', false, '6.6.6.6')$$,
  'P0001', 'rate_limited', 'too many tries from one address are refused');

select is(
  (select public.claim_rsvp_email_slot(id) and public.claim_rsvp_email_slot(id)
          and public.claim_rsvp_email_slot(id)
     from public.event_rsvps where lower(email) = 'b@example.com'),
  true, 'three link emails per RSVP are allowed');
select is(
  (select public.claim_rsvp_email_slot(id) from public.event_rsvps where lower(email) = 'b@example.com'),
  false, 'the fourth in a day is not');

select is(
  jsonb_array_length(public.event_page((select link_token from night), null,
    'aaaaaaaa-0000-0000-0000-00000000d001') -> 'rsvps'),
  4, 'the host sees every RSVP');

-- ---------------------------------------------------------------------------
-- Link off, reset; claim
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000d001", "role": "authenticated"}';
do $$ begin perform public.set_club_link_enabled((select club_id from night), false); end $$;
set local role service_role;
select is(
  public.event_page((select link_token from night)), null,
  'with the link off, the page shows nothing');

reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000d001", "role": "authenticated"}';
do $$ begin perform public.set_club_link_enabled((select club_id from night), true); end $$;
select isnt(
  public.reset_club_link((select club_id from night)), (select link_token from night),
  'reset gives a new token');

set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000d002", "role": "authenticated"}';
select is(
  public.claim_my_rsvps(), array[(select club_id from night)],
  'signing in claims the RSVP and joins the night''s group');

select * from finish();
rollback;
