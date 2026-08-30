begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(12);

select has_table('public', 'friendships', 'friendships table exists');

-- Alice and Bob share Riverside. Carol is in Oakfield alone. Dave is in
-- nothing at all.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'dave@example.com');

insert into public.clubs (id, name, slug, visibility, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside Mah Jongg', 'riverside',
   'private', 'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield Tiles', 'oakfield',
   'private', 'America/New_York', 'cccccccc-0000-0000-0000-000000000003');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'cccccccc-0000-0000-0000-000000000003', 'host', 'active');

-- Structure: an edge cannot point at itself, and cannot be duplicated.
select throws_ok(
  $$insert into public.friendships (profile_id, friend_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '23514',
  null,
  'a member cannot befriend themselves'
);

insert into public.friendships (profile_id, friend_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003');

select throws_ok(
  $$insert into public.friendships (profile_id, friend_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'cccccccc-0000-0000-0000-000000000003')$$,
  '23505',
  null,
  'the same edge cannot be stored twice'
);

-- can_reach: the shared-club branch.
select ok(
  public.can_reach('aaaaaaaa-0000-0000-0000-000000000001',
                   'bbbbbbbb-0000-0000-0000-000000000002'),
  'a shared active club makes someone reachable'
);
select ok(
  not public.can_reach('bbbbbbbb-0000-0000-0000-000000000002',
                       'cccccccc-0000-0000-0000-000000000003'),
  'no shared club and no friendship is not reachable'
);
select ok(
  not public.can_reach('bbbbbbbb-0000-0000-0000-000000000002',
                       'dddddddd-0000-0000-0000-000000000004'),
  'someone in no club at all is not reachable'
);

-- can_reach: the friendship branch, which is the whole point — Alice and
-- Carol have never shared a club and she can still reach her.
select ok(
  public.can_reach('aaaaaaaa-0000-0000-0000-000000000001',
                   'cccccccc-0000-0000-0000-000000000003'),
  'a friendship reaches across clubs that never overlapped'
);
select ok(
  not public.can_reach('cccccccc-0000-0000-0000-000000000003',
                       'aaaaaaaa-0000-0000-0000-000000000001'),
  'the edge is one-way — being friended does not make the friender reachable'
);

-- An inactive membership is not a shared club.
update public.club_members set status = 'removed'
 where profile_id = 'bbbbbbbb-0000-0000-0000-000000000002';
select ok(
  not public.can_reach('aaaaaaaa-0000-0000-0000-000000000001',
                       'bbbbbbbb-0000-0000-0000-000000000002'),
  'a removed membership stops being a shared club'
);

-- RLS: you read your own edges and nobody else's.
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select count(*)::int from public.friendships),
  1,
  'a member reads their own edges'
);

set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select is(
  (select count(*)::int from public.friendships),
  0,
  'a member cannot read who has friended them'
);

-- No write policy at all: every write goes through Task 2's functions.
select throws_ok(
  $$insert into public.friendships (profile_id, friend_id)
    values ('cccccccc-0000-0000-0000-000000000003',
            'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'a member cannot insert an edge directly'
);

select * from finish();
rollback;
