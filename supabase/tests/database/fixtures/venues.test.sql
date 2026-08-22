begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(32);

-- Structure
select has_table('public', 'venues', 'venues table exists');
select has_function('public', 'is_club_organizer', array['uuid'],
  'is_club_organizer exists');
select has_function('public', 'assert_club_organizer', array['uuid'],
  'assert_club_organizer exists');
select has_function('public', 'search_venues', array['uuid', 'text'],
  'search_venues exists');

-- Alice hosts Riverside. Bob hosts Oakfield. Carol is a plain member of
-- Riverside — the role boundary, not just the club boundary.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member');

-- Riverside adds two venues: a private one (a member's home) and a public
-- one (a real hall other clubs could use).
insert into public.venues
  (id, name, locality, visibility, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'Marie''s place', 'Newton',
   'club', 'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'St Mary''s Hall', 'Newton',
   'public', 'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------
-- Visibility, from both sides.
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  (select count(*)::int from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  0,
  'another club cannot read a club-visibility venue'
);

select is(
  (select count(*)::int from public.venues
   where id = '11111111-0000-0000-0000-000000000002'),
  1,
  'another club can read a public venue'
);

-- The same question through search, which is the path the app actually uses.
select is(
  (select count(*)::int from public.search_venues(
     'c2c2c2c2-0000-0000-0000-000000000002', 'Marie')),
  0,
  'search does not leak a club-visibility venue to another club'
);

select is(
  (select count(*)::int from public.search_venues(
     'c2c2c2c2-0000-0000-0000-000000000002', 'Mary')),
  1,
  'search returns a public venue to another club'
);

-- ---------------------------------------------------------------------
-- The edit boundary: added_by_club_id, not "organizes something".
-- ---------------------------------------------------------------------
select throws_ok(
  $$select public.update_venue(
      '11111111-0000-0000-0000-000000000002', 'Renamed By Bob',
      null, null, null, null)$$,
  '42501',
  null,
  'a host of another club cannot rename a public venue'
);

select throws_ok(
  $$select public.archive_venue('11111111-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'a host of another club cannot archive a public venue'
);

-- create_venue gets the same "another club" negative as update_venue and
-- archive_venue above: a host of Oakfield cannot create a venue attributed
-- to Riverside just by passing Riverside's id as target_club.
select throws_ok(
  $$select public.create_venue(
      'Sneaky Venue', null, null, null, null,
      'c1c1c1c1-0000-0000-0000-000000000001', false)$$,
  '42501',
  null,
  'a host of another club cannot create a venue attributed to it'
);

-- A plain member of the owning club is also refused.
set local request.jwt.claims =
  '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$select public.update_venue(
      '11111111-0000-0000-0000-000000000001', 'Renamed By Carol',
      null, null, null, null)$$,
  '42501',
  null,
  'a plain member of the owning club cannot rename its venue'
);

select is(
  (select count(*)::int from public.search_venues(
     'c1c1c1c1-0000-0000-0000-000000000001', 'Marie')),
  1,
  'a plain member of the owning club can still see its venues'
);

select throws_ok(
  $$select public.search_venues(
      'c2c2c2c2-0000-0000-0000-000000000002', 'Mary')$$,
  '42501',
  null,
  'search refuses a club the caller does not belong to'
);

-- ---------------------------------------------------------------------
-- The owning club's organizer can do all of it.
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$select public.update_venue(
      '11111111-0000-0000-0000-000000000001', 'Marie''s house',
      '42 Elm St', 'Newton', null, null)$$,
  'the owning club''s host can rename its venue'
);

select is(
  (select name from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  'Marie''s house',
  'the rename landed'
);

select is(
  (select address_line from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  '42 Elm St',
  'the address landed'
);

-- Nulls mean "leave alone", not "clear" — otherwise a screen that edits only
-- the name silently wipes the address.
select is(
  (select locality from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  'Newton',
  'a null argument leaves the existing value alone'
);

-- Creation defaults to club visibility. This is the whole privacy argument:
-- a host adding "Marie's place" at 11pm must not publish it by omission.
select lives_ok(
  $$select public.create_venue(
      'The Annexe', null, 'Newton', null, null,
      'c1c1c1c1-0000-0000-0000-000000000001', false)$$,
  'the owning club''s host can create a venue'
);

select is(
  (select visibility::text from public.venues where name = 'The Annexe'),
  'club',
  'a new venue is club-visibility by default'
);

select is(
  (select added_by_club_id from public.venues where name = 'The Annexe'),
  'c1c1c1c1-0000-0000-0000-000000000001'::uuid,
  'a new venue records the club that added it'
);

-- ---------------------------------------------------------------------
-- The one path that can publish a member's home address: an explicit
-- share_publicly => true, and nothing short of it, produces a public row.
-- There is deliberately no un-publish function, so a defect on this path is
-- unrecoverable through the API — it deserves its own direct test rather
-- than relying on the "defaults to club" assertions above.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.create_venue(
      'The Grange', null, 'Newton', null, null,
      'c1c1c1c1-0000-0000-0000-000000000001', true)$$,
  'the owning club''s host can create a venue with share_publicly => true'
);

select is(
  (select visibility::text from public.venues where name = 'The Grange'),
  'public',
  'share_publicly => true produces a public venue'
);

-- Bob (Oakfield) belongs to neither Riverside nor this venue's club, and is
-- the same caller the visibility tests above showed cannot read a
-- club-visibility Riverside venue. He must be able to read this one.
set local request.jwt.claims =
  '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  (select count(*)::int from public.venues where name = 'The Grange'),
  1,
  'a member of a different club can read the explicitly public venue'
);

set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

-- ---------------------------------------------------------------------
-- Archiving hides from search and preserves the row.
-- ---------------------------------------------------------------------
select lives_ok(
  $$select public.archive_venue('11111111-0000-0000-0000-000000000001')$$,
  'the owning club''s host can archive its venue'
);

select is(
  (select count(*)::int from public.search_venues(
     'c1c1c1c1-0000-0000-0000-000000000001', 'Marie')),
  0,
  'an archived venue is absent from search'
);

select is(
  (select count(*)::int from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  1,
  'an archived venue still exists and still resolves'
);

-- ---------------------------------------------------------------------
-- Duplicate control applies to public venues only.
-- ---------------------------------------------------------------------
set local role postgres;

select throws_ok(
  $$insert into public.venues
      (name, locality, visibility, added_by_club_id, created_by)
    values ('st mary''s hall', 'NEWTON', 'public',
      'c2c2c2c2-0000-0000-0000-000000000002',
      'bbbbbbbb-0000-0000-0000-000000000002')$$,
  '23505',
  null,
  'a duplicate public venue is rejected regardless of case or padding'
);

select lives_ok(
  $$insert into public.venues
      (name, locality, visibility, added_by_club_id, created_by)
    values ('Community Hall', 'Newton', 'club',
      'c1c1c1c1-0000-0000-0000-000000000001',
      'aaaaaaaa-0000-0000-0000-000000000001'),
    ('Community Hall', 'Newton', 'club',
      'c2c2c2c2-0000-0000-0000-000000000002',
      'bbbbbbbb-0000-0000-0000-000000000002')$$,
  'two clubs may each keep a private venue of the same name'
);

-- ---------------------------------------------------------------------
-- Grants: select only, and never TRUNCATE.
-- ---------------------------------------------------------------------
select ok(
  has_table_privilege('authenticated', 'public.venues', 'SELECT'),
  'authenticated can select venues'
);
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'INSERT'),
  'authenticated cannot insert venues directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'TRUNCATE'),
  'authenticated cannot TRUNCATE venues'
);

select * from finish();
rollback;
