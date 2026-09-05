begin;
set local search_path to extensions, public;
select plan(8);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000fa01', 'ai-host@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000fa02', 'ai-guest@example.com'),
  ('cccccccc-0000-0000-0000-00000000fa03', 'ai-guest2@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000fa01', 'Accept Club', 'accept-club',
   'aaaaaaaa-0000-0000-0000-00000000fa01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000fa01',
   'aaaaaaaa-0000-0000-0000-00000000fa01', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000fa01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000fa01',
   'aaaaaaaa-0000-0000-0000-00000000fa01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, game_mode, created_by
) values (
  '22222222-0000-0000-0000-00000000fa01', 'c1c1c1c1-0000-0000-0000-00000000fa01',
  'Private Game', '11111111-0000-0000-0000-00000000fa01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only',
  'aaaaaaaa-0000-0000-0000-00000000fa01'
), (
  '33333333-0000-0000-0000-00000000fa01', 'c1c1c1c1-0000-0000-0000-00000000fa01',
  'Cancelled Game', '11111111-0000-0000-0000-00000000fa01',
  now() + interval '1 day', now() + interval '1 day 3 hours', 'invite_only',
  'aaaaaaaa-0000-0000-0000-00000000fa01'
);

update public.events set status = 'cancelled'
where id = '33333333-0000-0000-0000-00000000fa01';

insert into public.event_tables (id, event_id, club_id, label, position) values
  ('44444444-0000-0000-0000-00000000fa01', '22222222-0000-0000-0000-00000000fa01',
   'c1c1c1c1-0000-0000-0000-00000000fa01', 'Table 1', 1);

insert into public.club_invites (club_id, token, event_id, expires_at) values
  ('c1c1c1c1-0000-0000-0000-00000000fa01', 'game-invite-token',
   '22222222-0000-0000-0000-00000000fa01', now() + interval '7 days'),
  ('c1c1c1c1-0000-0000-0000-00000000fa01', 'plain-invite-token',
   null, now() + interval '7 days'),
  ('c1c1c1c1-0000-0000-0000-00000000fa01', 'cancelled-game-token',
   '33333333-0000-0000-0000-00000000fa01', now() + interval '7 days');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000fa02", "role": "authenticated"}';

select is(
  (public.accept_club_invite('game-invite-token')->>'club_id')::uuid,
  'c1c1c1c1-0000-0000-0000-00000000fa01'::uuid,
  'accepting a game-tied invite returns the club id'
);

select is(
  (public.accept_club_invite('game-invite-token')->>'club_id')::uuid,
  null,
  'the same token cannot be redeemed twice'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-00000000fa01'
     and profile_id = 'bbbbbbbb-0000-0000-0000-00000000fa02'),
  1,
  'redeeming a game-tied invite still creates club membership'
);

select is(
  (select count(*)::int from public.bookings
   where event_id = '22222222-0000-0000-0000-00000000fa01'
     and profile_id = 'bbbbbbbb-0000-0000-0000-00000000fa02'
     and status = 'confirmed'),
  1,
  'redeeming a game-tied invite seats the guest at the tied event'
);

set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000fa03", "role": "authenticated"}';

-- A plain (non-event) invite is unaffected.
select is(
  (public.accept_club_invite('plain-invite-token')->>'event_id'),
  null,
  'a plain club invite has no event_id in its response'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-00000000fa01'
     and profile_id = 'cccccccc-0000-0000-0000-00000000fa03'),
  1,
  'a plain club invite still creates membership'
);

-- A guest invited to a since-cancelled game still becomes a member.
reset role;
insert into auth.users (id, email) values
  ('dddddddd-0000-0000-0000-00000000fa04', 'ai-guest3@example.com');
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "dddddddd-0000-0000-0000-00000000fa04", "role": "authenticated"}';

select lives_ok(
  $$select public.accept_club_invite('cancelled-game-token')$$,
  'accepting an invite to a since-cancelled game does not error'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-00000000fa01'
     and profile_id = 'dddddddd-0000-0000-0000-00000000fa04'),
  1,
  'membership is still created even though seating was skipped'
);

select * from finish();
rollback;
