begin;
set local search_path to extensions, public;
select plan(5);

insert into auth.users (id, email, email_confirmed_at) values
  ('aaaaaaaa-0000-0000-0000-00000000e301', 'mine-host@example.com', now()),
  ('bbbbbbbb-0000-0000-0000-00000000e302', 'mine-maybe@example.com', now()),
  ('cccccccc-0000-0000-0000-00000000e303', 'mine-no@example.com', now()),
  ('dddddddd-0000-0000-0000-00000000e304', 'mine-stranger@example.com', now());

create temp table night (link_token text) on commit drop;
grant all on night to authenticated, service_role;

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000e301", "role": "authenticated"}';
insert into night
select r->>'link_token' from public.create_mahj_night(
  'Mine Night', current_date + 7, '19:00', 180, '1 Elm St', '', 1, 'jade', false,
  '', 'America/New_York') r;

select is(
  (select is_host::text || '|' || coalesce(rsvp_status, '-') from public.my_mahj_nights()),
  'true|-', 'the host sees their night, as host');

-- Two guests RSVP and then sign in (claim links the RSVP to the account).
set local role service_role;
select public.submit_rsvp((select link_token from night), 'May', 'mine-maybe@example.com', 'maybe', false, false, false, false, '3.3.3.1');
select public.submit_rsvp((select link_token from night), 'Noel', 'mine-no@example.com', 'no', false, false, false, false, '3.3.3.2');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000e302", "role": "authenticated"}';
select public.claim_my_rsvps();
select is(
  (select is_host::text || '|' || rsvp_status from public.my_mahj_nights()),
  'false|maybe', 'a guest sees the night with their own answer');

set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000e303", "role": "authenticated"}';
select public.claim_my_rsvps();
select is(
  (select count(*)::int from public.my_mahj_nights()), 0,
  'a guest who said no does not');

set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-00000000e304", "role": "authenticated"}';
select is(
  (select count(*)::int from public.my_mahj_nights()), 0,
  'nor does anyone else');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.my_mahj_nights()$$, '42501', null, 'signed-out callers cannot call it');

select * from finish();
rollback;
