begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(12);

-- One club. Alice hosts, Bob co-organizes, Carol is a plain member, and Dan
-- is an existing active member whose auth.users.email is deliberately
-- mixed-case -- case 4 below invites him again with an all-lowercase email
-- to prove the collision check's `lower(...) = lower(...)` genuinely does
-- the folding, rather than merely working by coincidence because every
-- fixture in the repo happens to use consistently-lowercase emails.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000fa01', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-00000000fa02', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-00000000fa03', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-00000000fa04', 'Dan@Example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000fa01', 'Invite Test Club',
   'invite-test-club', 'aaaaaaaa-0000-0000-0000-00000000fa01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000fa01',
   'aaaaaaaa-0000-0000-0000-00000000fa01', 'host'),
  ('c1c1c1c1-0000-0000-0000-00000000fa01',
   'bbbbbbbb-0000-0000-0000-00000000fa02', 'co_organizer'),
  ('c1c1c1c1-0000-0000-0000-00000000fa01',
   'cccccccc-0000-0000-0000-00000000fa03', 'member'),
  ('c1c1c1c1-0000-0000-0000-00000000fa01',
   'dddddddd-0000-0000-0000-00000000fa04', 'member');

-- A venue and event on the same club, for case 6 (event-tied invite).
insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000fa01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000fa01',
   'aaaaaaaa-0000-0000-0000-00000000fa01');

insert into public.events (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('22222222-0000-0000-0000-00000000fa01', 'c1c1c1c1-0000-0000-0000-00000000fa01',
   'Test Game', '11111111-0000-0000-0000-00000000fa01',
   now() + interval '1 day', now() + interval '1 day 3 hours',
   'aaaaaaaa-0000-0000-0000-00000000fa01');

-- ---------------------------------------------------------------------------
-- Case 1: the host creates an invite for an email with no existing account.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000fa01", "role": "authenticated"}';

create temporary table invite1 on commit drop as
  select public.create_club_invite(
    'c1c1c1c1-0000-0000-0000-00000000fa01', 'newguest1@example.com',
    'New Guest One', null) as id;

select isnt(
  (select id from invite1),
  null,
  'a host creates an invite and gets back a non-null uuid'
);

select is(
  (select email from public.club_invites where id = (select id from invite1)),
  'newguest1@example.com',
  'the created row has the target email'
);

select is(
  (select accepted_at from public.club_invites where id = (select id from invite1)),
  null,
  'a freshly created invite has not been accepted'
);

select is(
  (select declined_at from public.club_invites where id = (select id from invite1)),
  null,
  'a freshly created invite has not been declined'
);

-- ---------------------------------------------------------------------------
-- Case 2: a co-organizer can also create one.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-00000000fa02", "role": "authenticated"}';

create temporary table invite2 on commit drop as
  select public.create_club_invite(
    'c1c1c1c1-0000-0000-0000-00000000fa01', 'newguest2@example.com',
    'New Guest Two', null) as id;

select isnt(
  (select id from invite2),
  null,
  'a co-organizer creates an invite and gets back a non-null uuid'
);

select is(
  (select email from public.club_invites where id = (select id from invite2)),
  'newguest2@example.com',
  'the co-organizer''s created row has the target email'
);

select is(
  (select accepted_at from public.club_invites where id = (select id from invite2)),
  null,
  'the co-organizer''s freshly created invite has not been accepted'
);

select is(
  (select declined_at from public.club_invites where id = (select id from invite2)),
  null,
  'the co-organizer''s freshly created invite has not been declined'
);

-- ---------------------------------------------------------------------------
-- Case 3: a plain member cannot create an invite.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-00000000fa03", "role": "authenticated"}';

select throws_ok(
  $$select public.create_club_invite(
      'c1c1c1c1-0000-0000-0000-00000000fa01', 'x@example.com', '', null)$$,
  '42501',
  null,
  'a plain member cannot invite'
);

-- ---------------------------------------------------------------------------
-- Case 4: re-inviting an existing active member is blocked, even when the
-- casing of the two emails genuinely differs -- Dan's auth.users.email is
-- 'Dan@Example.com' but the invite attempt below uses all-lowercase
-- 'dan@example.com'. If the RPC's `lower(u.email) = lower(target_email)`
-- comparison were ever replaced with a plain `=`, this is the assertion that
-- would catch it (an exact-match check would let this attempt through and
-- this throws_ok would fail).
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000fa01", "role": "authenticated"}';

select throws_ok(
  $$select public.create_club_invite(
      'c1c1c1c1-0000-0000-0000-00000000fa01', 'dan@example.com', '', null)$$,
  'P0001',
  'That person is already in this club',
  'cannot re-invite an existing member, even with mismatched email casing'
);

-- ---------------------------------------------------------------------------
-- Case 5: a caller with no session at all (no `sub` in the JWT claims) is
-- blocked the same way as case 3 -- this guard needs its own assertion
-- rather than assuming the organizer check catches a null caller the same
-- way it catches a real, non-organizing one (mirrors
-- waitlist_promotion.test.sql's own dedicated null-caller case).
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"role": "authenticated"}';

select throws_ok(
  $$select public.create_club_invite(
      'c1c1c1c1-0000-0000-0000-00000000fa01', 'nobody@example.com', '', null)$$,
  '42501',
  null,
  'a caller with no session at all cannot invite'
);

-- ---------------------------------------------------------------------------
-- Case 6: an invite tied to a real event of the same club actually stores
-- that event_id on the row.
-- ---------------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000fa01", "role": "authenticated"}';

create temporary table invite6 on commit drop as
  select public.create_club_invite(
    'c1c1c1c1-0000-0000-0000-00000000fa01', 'eventguest@example.com', '',
    '22222222-0000-0000-0000-00000000fa01') as id;

select is(
  (select event_id from public.club_invites where id = (select id from invite6)),
  '22222222-0000-0000-0000-00000000fa01'::uuid,
  'an event-tied invite stores the event_id on the created row'
);

reset role;

select * from finish();
rollback;
