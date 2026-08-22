begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(17);

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

select * from finish();
rollback;
