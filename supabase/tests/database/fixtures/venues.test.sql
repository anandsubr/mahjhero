begin;
-- pgTAP lives in the `extensions` schema, which is not on the runner's
-- search_path. Every test file needs this line or plan() will not resolve.
set local search_path to extensions, public;

select plan(44);

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
--
-- Alice also hosts Lakeside. One organizer with two clubs is what makes
-- `added_by_club_id` testable at all: while every organizer had exactly one
-- club, a create_venue that recorded "whichever club the caller organizes"
-- was indistinguishable from one that recorded `target_club`, and the
-- assertion below could not tell them apart.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'alice@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'bob@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'carol@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Oakfield', 'oakfield',
   'America/New_York', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('c3c3c3c3-0000-0000-0000-000000000003', 'Lakeside', 'lakeside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002', 'host'),
  ('c3c3c3c3-0000-0000-0000-000000000003',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member');

-- Riverside adds two venues: a private one (a member's home) and a public
-- one (a real hall other clubs could use).
--
-- Marie's place carries all four optional address columns, so that
-- update_venue's "a null argument means leave this alone" rule has something
-- to leave alone in each of them. With region and postal_code empty, a
-- version of update_venue that overwrote them with NULL was
-- indistinguishable from one that preserved them.
insert into public.venues
  (id, name, locality, region, postal_code, visibility, added_by_club_id,
   created_by) values
  ('11111111-0000-0000-0000-000000000001', 'Marie''s place', 'Newton',
   'MA', '02458', 'club', 'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-0000-0000-0000-000000000002', 'St Mary''s Hall', 'Newton',
   null, null, 'public', 'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

/*
 * The column default, which nothing else in this file can see.
 *
 * Every other visibility assertion goes through create_venue, and
 * create_venue always supplies an explicit value — so
 * `alter table venues alter column visibility set default 'public'` passed
 * the entire fixture. The default is the last line of defence for any writer
 * that does not go through the function, and it gets its own row.
 */
insert into public.venues (id, name, locality, added_by_club_id, created_by)
values
  ('11111111-0000-0000-0000-000000000003', 'The Nook', 'Newton',
   'c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001');

select is(
  (select visibility::text from public.venues
   where id = '11111111-0000-0000-0000-000000000003'),
  'club',
  'the visibility column itself defaults to club when none is supplied'
);

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
      '42 Elm St', null, null, null)$$,
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

/*
 * Nulls mean "leave alone", not "clear" — otherwise a screen that edits only
 * the name silently wipes the address.
 *
 * This has to be asserted column by column. The call above passes a value
 * for name and address_line and NULL for the other three, so those three are
 * the ones the rule is under test on; the earlier version of this block
 * passed 'Newton' for locality and then asserted locality was still
 * 'Newton', which is true of an implementation that ignores the coalesce
 * entirely. Dropping `coalesce` from any one of these four columns passed
 * the whole fixture.
 */
select is(
  (select locality from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  'Newton',
  'a null locality argument leaves the existing locality alone'
);

select is(
  (select region from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  'MA',
  'a null region argument leaves the existing region alone'
);

select is(
  (select postal_code from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  '02458',
  'a null postal_code argument leaves the existing postal code alone'
);

-- And the address_line the previous call set survives an edit that names
-- only the venue — the exact screen the rule exists for.
select lives_ok(
  $$select public.update_venue(
      '11111111-0000-0000-0000-000000000001', 'Marie''s home',
      null, null, null, null)$$,
  'a name-only edit is accepted'
);

select is(
  (select address_line from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  '42 Elm St',
  'a null address_line argument leaves the existing address alone'
);

/*
 * The four null-means-leave-alone assertions above cannot tell a working
 * write-through from one that silently discards the argument and keeps the
 * old value -- both produce the same "unchanged" result when the argument is
 * null. `address_line` is exercised by the rename above (it goes from NULL
 * to '42 Elm St'), but locality, region and postal_code have only ever been
 * left alone in this file, never actually changed. Prove the write-through
 * for all three by supplying real values and checking they landed. Setup
 * only -- the call itself spends no plan slot.
 */
do $locality_edit$
begin
  perform public.update_venue(
    '11111111-0000-0000-0000-000000000001', null,
    null, 'Cambridge', 'NH', '02139');
end
$locality_edit$;

select is(
  (select locality from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  'Cambridge',
  'a non-null locality argument overwrites the existing locality'
);

select is(
  (select region from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  'NH',
  'a non-null region argument overwrites the existing region'
);

select is(
  (select postal_code from public.venues
   where id = '11111111-0000-0000-0000-000000000001'),
  '02139',
  'a non-null postal_code argument overwrites the existing postal code'
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

-- ...and it records `target_club` specifically, not "a club this caller
-- happens to organize". Alice hosts both Riverside and Lakeside; a
-- create_venue that picked the caller's own first club would file this one
-- under Riverside and pass every other assertion in this file.
select lives_ok(
  $$select public.create_venue(
      'Lakeside Rooms', null, 'Lakeside', null, null,
      'c3c3c3c3-0000-0000-0000-000000000003', false)$$,
  'an organizer of two clubs can create a venue for the second'
);

select is(
  (select added_by_club_id from public.venues where name = 'Lakeside Rooms'),
  'c3c3c3c3-0000-0000-0000-000000000003'::uuid,
  'the new venue is filed under target_club, not the caller''s other club'
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
-- UPDATE and DELETE were the two verbs this block named in its heading and
-- never checked: granting either of them to authenticated passed the whole
-- fixture, because every write assertion above goes through the definer
-- functions and none of them touches the table grant.
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'UPDATE'),
  'authenticated cannot update venues directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'DELETE'),
  'authenticated cannot delete venues directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.venues', 'TRUNCATE'),
  'authenticated cannot TRUNCATE venues'
);

select * from finish();
rollback;
