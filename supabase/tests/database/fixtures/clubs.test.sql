begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(41);

-- Structure
select has_table('public', 'clubs', 'clubs table exists');
select has_table('public', 'club_members', 'club_members table exists');
select has_table('public', 'club_invites', 'club_invites table exists');

-- Two members, two clubs. Alice hosts Riverside; Bob hosts Oakfield.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside Mah Jongg', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield Tiles', 'oakfield',
   'public', 'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host');

-- RLS: a member sees their own club and not the other one.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  1,
  'a member can read their own club'
);

select is(
  (select count(*)::int from public.clubs
   where id = 'c2c2c2c2-0000-0000-0000-000000000002'),
  0,
  'a member cannot read a club they do not belong to'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c2c2c2c2-0000-0000-0000-000000000002'),
  0,
  'a member cannot read another club roster'
);

-- The widened profiles policy: co-members are visible, strangers are not.
select is(
  (select count(*)::int from public.profiles
   where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'a member can still read their own profile'
);

select is(
  (select count(*)::int from public.profiles
   where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,
  'a member cannot read the profile of someone in no shared club'
);

-- A member may not promote themselves.
select throws_ok(
  $$update public.club_members set role = 'host'
    where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
      and profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'a member cannot change roles directly'
);

-- ---------------------------------------------------------------------------
-- WRITE isolation. Read isolation above is only half the property, and the
-- missing half is where the real breach lives: an earlier version of this
-- schema had `with check (auth.uid() = profile_id)` on club_members, which
-- constrains who the row is about and nothing about which club or what role.
-- Any authenticated user holding a club's uuid could insert themselves into
-- it as host. Every assertion below would have caught that; none of the read
-- assertions did.
-- ---------------------------------------------------------------------------

select throws_ok(
  $$insert into public.club_members (club_id, profile_id, role)
    values ('c2c2c2c2-0000-0000-0000-000000000002',
            'aaaaaaaa-0000-0000-0000-000000000001', 'host')$$,
  '42501',
  null,
  'a member cannot insert themselves into another club'
);

select throws_ok(
  $$insert into public.club_members (club_id, profile_id, role)
    values ('c1c1c1c1-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001', 'host')$$,
  '42501',
  null,
  'a member cannot insert a membership even in their own club'
);

select throws_ok(
  $$insert into public.club_invites (club_id, token, invited_by)
    values ('c2c2c2c2-0000-0000-0000-000000000002', 'sneaky-token',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a member cannot create an invite to another club'
);

with attempted as (
  update public.clubs set name = 'Hijacked'
  where id = 'c2c2c2c2-0000-0000-0000-000000000002'
  returning 1
)
select is(
  (select count(*)::int from attempted),
  0,
  'a member cannot update another club'
);

-- create_club is the only way a membership is created, and it seats the
-- caller as host in the same transaction — so a club can never exist with
-- no host, which would make it unreachable by every membership-scoped policy.
--
-- The call has to be its own statement. Calling create_club() inside the
-- WHERE clause of a query against club_members cannot work: the query's
-- snapshot is taken before the volatile function runs, so it can never see
-- the row that function just inserted. That is a command-visibility rule,
-- not an RLS effect — it fails the same way as superuser.
create temporary table created_club on commit drop as
  select public.create_club('Test Club', 'Tuesdays') as id;

select is(
  (select count(*)::int
   from public.club_members
   where club_id = (select id from created_club)
     and profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and role = 'host'),
  1,
  'create_club seats the caller as host'
);

select is(
  (select count(*)::int from public.clubs
   where id = (select id from created_club)),
  1,
  'the creator can read the club they just made'
);

-- Server-generated invite tokens: the client never supplies one (see
-- lib/clubs.ts createInvite / importRoster and the
-- server_generated_invite_tokens migration). Still acting as Alice, host of
-- her own club, so the insert clears club_invites_insert_organizer.
create temporary table invite_tokens on commit drop as
  with i1 as (
    insert into public.club_invites (club_id, invited_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')
    returning token
  ), i2 as (
    insert into public.club_invites (club_id, invited_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')
    returning token
  )
  select token from i1
  union all
  select token from i2;

select is(
  (select count(*)::int from invite_tokens where token is null),
  0,
  'an invite inserted without a token gets one from the column default'
);

select is(
  (select count(distinct token)::int from invite_tokens),
  2,
  'two invites inserted without a token in the same transaction do not collide'
);

-- Invite acceptance. Bob redeems an invite to Alice's club.
set local role postgres;
reset request.jwt.claims;

insert into public.club_invites (club_id, token, invited_by, expires_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'good-token',
   'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '7 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'stale-token',
   'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 day');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  public.accept_club_invite('good-token'),
  'c1c1c1c1-0000-0000-0000-000000000001'::uuid,
  'a valid token returns the club id'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
     and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'redeeming an invite creates the membership'
);

-- The granted role is the literal in the function body, never sourced from
-- the invite row or the caller — the plan's central property. A test that
-- only checks the row exists would still pass if that literal were 'host'.
select is(
  (select role::text from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
     and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'member',
  'the granted membership role is member, not whatever the caller wants'
);

select is(
  (select status::text from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
     and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'active',
  'the granted membership is active'
);

-- Cross-club isolation: redeeming Riverside's invite must not touch Bob's
-- existing, unrelated membership at Oakfield.
select is(
  (select count(*)::int from public.club_members
   where profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  2,
  'Bob now has exactly two memberships: Oakfield plus the new Riverside one'
);

select is(
  (select role::text from public.club_members
   where club_id = 'c2c2c2c2-0000-0000-0000-000000000002'
     and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'host',
  'Bob''s own club role is untouched by redeeming an invite elsewhere'
);

select is(
  public.accept_club_invite('good-token'),
  null,
  'a token cannot be redeemed twice'
);

select is(
  public.accept_club_invite('stale-token'),
  null,
  'an expired token is refused'
);

select is(
  public.accept_club_invite('no-such-token'),
  null,
  'a token that was never issued is refused'
);

-- The three refused attempts above (reuse, expired, unknown) must not have
-- written anything. This has to run after all three, not right after the
-- successful redemption above — a write-before-validate regression on a
-- refused path would otherwise have no assertion standing in front of it.
select is(
  (select count(*)::int from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
     and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'refused redemptions did not write a second membership row'
);

-- A member who was removed and later re-invited must be reactivated, not
-- left stranded: club_members.status defaults to active and is_club_member
-- requires it, so `on conflict do nothing` would leave a removed row
-- removed, still burn the new invite, and return a club id the client
-- treats as success while every row in that club stays RLS-invisible.
set local role postgres;
update public.club_members set status = 'removed'
where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
  and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002';

insert into public.club_invites (club_id, token, invited_by, expires_at) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'reactivation-token',
   'aaaaaaaa-0000-0000-0000-000000000001', now() + interval '7 days');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select public.accept_club_invite('reactivation-token');

select is(
  (select status::text from public.club_members
   where club_id = 'c1c1c1c1-0000-0000-0000-000000000001'
     and profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  'active',
  'a removed member who redeems a fresh invite is reactivated, not stranded'
);

-- ---------------------------------------------------------------------------
-- Column exposure through the widened profiles policy.
--
-- `20260822033527` widened `profiles` select to "own row OR any co-member's
-- row" so a roster could show names and skill levels. A policy is per-row and
-- cannot be per-column, so that handed every co-member the whole profile —
-- quiet hours, notification channel, timezone. Not a tenant-boundary breach,
-- but anyone in your club learned what hours you sleep, and no assertion
-- anywhere could see it: the existing profiles tests count rows, and the row
-- count was the intended part.
--
-- Alice and Bob now share Riverside (Bob redeemed an invite above), and this
-- still runs as Bob, so this is the exact shape that was verified live.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.profiles
   where id = 'aaaaaaaa-0000-0000-0000-000000000001'
     and quiet_hours_start is not null),
  0,
  'a co-member cannot read another member''s quiet_hours_start'
);

-- The other half: the roster still works. Without this, the assertion above
-- passes by making co-members invisible to each other entirely, which would
-- break every club screen.
set local role postgres;
reset request.jwt.claims;
update public.profiles
set display_name = 'Alice Alder', skill_level = 'advanced'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  (select display_name from public.club_roster(
     'c1c1c1c1-0000-0000-0000-000000000001')
   where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Alice Alder',
  'club_roster still shows a co-member''s display name'
);

select is(
  (select skill_level::text from public.club_roster(
     'c1c1c1c1-0000-0000-0000-000000000001')
   where profile_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'advanced',
  'club_roster still shows a co-member''s skill level'
);

-- club_roster is security definer, so RLS does not protect it and the
-- membership check in its body is the tenant boundary. Bob hosts Oakfield but
-- is asking about a club he does not belong to.
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.club_roster(
     'c2c2c2c2-0000-0000-0000-000000000002')),
  0,
  'club_roster returns nothing for a club the caller does not belong to'
);

-- ---------------------------------------------------------------------------
-- Invite attribution and club identity.
-- ---------------------------------------------------------------------------

-- invited_by was client-supplied and unchecked: the insert policy asked only
-- whether the caller was an organizer, so a host could sign an invite — or a
-- whole imported batch — with somebody else's profile id.
select throws_ok(
  $$insert into public.club_invites (club_id, invited_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001',
            'bbbbbbbb-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'a host cannot attribute an invite to another profile'
);

-- clubs UPDATE had `using` and no `with check`, and was unbounded by column.
-- Slug is globally unique, so an ordinary host session could squat any slug a
-- future public-club URL would want.
select throws_ok(
  $$update public.clubs set slug = 'squatted'
    where id = 'c1c1c1c1-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'a host cannot rewrite their club''s slug'
);

-- The positive case, so the freeze cannot pass by blocking every host update.
with renamed as (
  update public.clubs set name = 'Riverside Renamed'
  where id = 'c1c1c1c1-0000-0000-0000-000000000001'
  returning 1
)
select is(
  (select count(*)::int from renamed),
  1,
  'a host can still rename their own club'
);

-- ---------------------------------------------------------------------------
-- Account deletion must not orphan a club.
--
-- club_members cascades from profiles (20260822033527:22) but clubs.created_by
-- is `on delete set null` (20260822040732:95-103), so before the succession
-- trigger both of these were permanent and unrecoverable through the UI:
--
--   * the sole member of a club deletes their account -> the club survives
--     with zero members, invisible to every membership-scoped policy, its
--     globally-unique slug taken forever;
--   * the host of a multi-member club deletes their account -> zero hosts.
--     clubs_update_host and both club_invites organizer policies require an
--     active host, and role promotion is deferred to a later plan, so the
--     remaining members can neither change the club nor invite anyone.
--
-- Both delete `auth.users` rather than club_members directly, so the assertion
-- exercises the real cascade an account deletion produces.
-- ---------------------------------------------------------------------------
set local role postgres;
reset request.jwt.claims;

insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dave@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'erin@example.com'),
  ('ffffffff-0000-0000-0000-000000000006', 'frank@example.com');

-- Carol's club: she is the only member.
insert into public.clubs (id, name, slug, created_by) values
  ('c3c3c3c3-0000-0000-0000-000000000003', 'Carol Solo', 'carol-solo',
   'cccccccc-0000-0000-0000-000000000003');
insert into public.club_members (club_id, profile_id, role, joined_at) values
  ('c3c3c3c3-0000-0000-0000-000000000003',
   'cccccccc-0000-0000-0000-000000000003', 'host', now());

-- Dave's club: Erin joined before Frank, so Erin is the longest-tenured
-- remaining member and should inherit.
insert into public.clubs (id, name, slug, created_by) values
  ('c4c4c4c4-0000-0000-0000-000000000004', 'Dave Hosts', 'dave-hosts',
   'dddddddd-0000-0000-0000-000000000004');
insert into public.club_members (club_id, profile_id, role, joined_at) values
  ('c4c4c4c4-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000004', 'host', now() - interval '10 days'),
  ('c4c4c4c4-0000-0000-0000-000000000004',
   'eeeeeeee-0000-0000-0000-000000000005', 'member', now() - interval '5 days'),
  ('c4c4c4c4-0000-0000-0000-000000000004',
   'ffffffff-0000-0000-0000-000000000006', 'member', now() - interval '1 day');

delete from auth.users where id = 'cccccccc-0000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.clubs
   where id = 'c3c3c3c3-0000-0000-0000-000000000003'),
  0,
  'a club whose last member deletes their account is deleted, not orphaned'
);

delete from auth.users where id = 'dddddddd-0000-0000-0000-000000000004';

select is(
  (select count(*)::int from public.clubs
   where id = 'c4c4c4c4-0000-0000-0000-000000000004'),
  1,
  'a club with members left survives its host deleting their account'
);

select is(
  (select count(*)::int from public.club_members
   where club_id = 'c4c4c4c4-0000-0000-0000-000000000004'
     and role = 'host' and status = 'active'),
  1,
  'exactly one host remains after the host deletes their account'
);

select is(
  (select profile_id from public.club_members
   where club_id = 'c4c4c4c4-0000-0000-0000-000000000004'
     and role = 'host' and status = 'active'),
  'eeeeeeee-0000-0000-0000-000000000005'::uuid,
  'the longest-tenured remaining member inherits the host role'
);

-- The promoted host can actually do the things a host does. Zero hosts froze
-- the club precisely because these two policies require one.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';

with renamed as (
  update public.clubs set name = 'Erin Hosts'
  where id = 'c4c4c4c4-0000-0000-0000-000000000004'
  returning 1
)
select is(
  (select count(*)::int from renamed),
  1,
  'the promoted host can update the club'
);

select lives_ok(
  $$insert into public.club_invites (club_id)
    values ('c4c4c4c4-0000-0000-0000-000000000004')$$,
  'the promoted host can create an invite'
);

select * from finish();
rollback;
