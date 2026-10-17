begin;
set local search_path to extensions, public;

select plan(60);

-- Club 1 (c1): host H(a), members M(b) and P(c), removed member R(d).
-- Club 2 (c2): host O(e), plain member Q(f) — outsiders to c1.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'host@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'member@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'other-member@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'removed@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'other-host@example.com'),
  ('ffffffff-0000-0000-0000-000000000006', 'other-club-member@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside Mah Jongg', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Hilltop Mah Jongg', 'hilltop',
   'America/New_York', 'eeeeeeee-0000-0000-0000-000000000005');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000003', 'member', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000004', 'member', 'removed'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'eeeeeeee-0000-0000-0000-000000000005', 'host', 'active'),
  ('c2c2c2c2-0000-0000-0000-000000000002',
   'ffffffff-0000-0000-0000-000000000006', 'member', 'active');

-- Objects already uploaded (the client uploads before calling
-- add_club_media). owner_id is the text uid the Storage API stamps.
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/photos/p1.jpg',
   'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/files/f1/Rules.pdf',
   'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/files/f2/sheet.xlsx',
   'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/files/f4/big.pdf',
   'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/files/f5/run.exe',
   'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/photos/png.jpg',
   'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/photos/meta.jpg',
   'bbbbbbbb-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/photos/c-owned.jpg',
   'cccccccc-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003'),
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/photos/r-owned.jpg',
   'dddddddd-0000-0000-0000-000000000004', 'dddddddd-0000-0000-0000-000000000004');

-- A row the removed member R added while still active.
insert into public.club_media
  (club_id, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by)
values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
   'c1c1c1c1-0000-0000-0000-000000000001/photos/r-owned.jpg', 'r.jpg', 'image/jpeg', 100,
   'dddddddd-0000-0000-0000-000000000004')
returning id as r_media_id \gset

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
select ok(
  not has_function_privilege('anon',
    'public.add_club_media(uuid, text, text, text, text, int, int, int)', 'EXECUTE'),
  'anon cannot execute add_club_media'
);
select ok(
  not has_function_privilege('anon', 'public.remove_club_media(uuid)', 'EXECUTE'),
  'anon cannot execute remove_club_media'
);
select ok(
  has_function_privilege('authenticated',
    'public.add_club_media(uuid, text, text, text, text, int, int, int)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.remove_club_media(uuid)', 'EXECUTE'),
  'authenticated can execute add_club_media and remove_club_media'
);
select ok(
  not has_function_privilege('anon',
    'public.fetch_club_media(uuid, text, timestamptz, int)', 'EXECUTE'),
  'anon cannot execute fetch_club_media'
);
select ok(
  has_function_privilege('authenticated',
    'public.fetch_club_media(uuid, text, timestamptz, int)', 'EXECUTE'),
  'authenticated can execute fetch_club_media'
);
select ok(
  not has_table_privilege('authenticated', 'public.club_media', 'INSERT')
  and not has_table_privilege('authenticated', 'public.club_media', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.club_media', 'DELETE'),
  'authenticated has no direct insert/update/delete on club_media'
);
select ok(
  has_table_privilege('authenticated', 'public.club_media', 'SELECT')
  and not has_table_privilege('anon', 'public.club_media', 'SELECT'),
  'authenticated can select club_media (through RLS); anon cannot'
);
select is(
  (select public from storage.buckets where id = 'club-media'),
  false,
  'the club-media bucket exists and is private'
);

-- ---------------------------------------------------------------------
-- add_club_media
-- ---------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/p1.jpg', 'IMG_0001.jpg',
      'image/jpeg', 250000, 1600, 1200)$$,
  'a member can add a photo they uploaded'
);

select lives_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'file',
      'c1c1c1c1-0000-0000-0000-000000000001/files/f1/Rules.pdf', 'Rules.pdf',
      'application/pdf', 10485760)$$,
  'a member can add a file of exactly 10 MB'
);

select is(
  (select row(kind, file_name, mime_type, size_bytes, width, height, uploaded_by)::text
     from public.club_media
    where storage_path = 'c1c1c1c1-0000-0000-0000-000000000001/photos/p1.jpg'),
  row('photo', 'IMG_0001.jpg', 'image/jpeg', 250000, 1600, 1200,
      'bbbbbbbb-0000-0000-0000-000000000002'::uuid)::text,
  'the photo row stores its metadata and the caller as uploader'
);

select is(
  (select row(kind, width, height)::text from public.club_media
    where storage_path = 'c1c1c1c1-0000-0000-0000-000000000001/files/f1/Rules.pdf'),
  row('file', null::int, null::int)::text,
  'the file row is stored with null dimensions by default'
);

select lives_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'file',
      'c1c1c1c1-0000-0000-0000-000000000001/files/f2/sheet.xlsx', 'sheet.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 2048)$$,
  'an xlsx file is allowed'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/files/f1/Rules.pdf', 'x.jpg', 'image/jpeg', 100)$$,
  '22023', 'invalid_path',
  'a photo outside the club''s photos/ folder is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c2c2c2c2-0000-0000-0000-000000000002/photos/p3.jpg', 'x.jpg', 'image/jpeg', 100)$$,
  '22023', 'invalid_path',
  'a path under another club''s folder is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'file',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/p1.jpg', 'a.pdf', 'application/pdf', 100)$$,
  '22023', 'invalid_path',
  'a file outside the club''s files/ folder is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/', 'x.jpg', 'image/jpeg', 100)$$,
  '22023', 'invalid_path',
  'a bare prefix with nothing after it is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/../files/f1/Rules.pdf', 'x.jpg',
      'image/jpeg', 100)$$,
  '22023', 'invalid_path',
  'a path containing .. is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/c-owned.jpg', 'x.jpg', 'image/jpeg', 100)$$,
  '22023', 'invalid_path',
  'a member cannot claim another member''s uploaded object'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/never-uploaded.jpg', 'x.jpg',
      'image/jpeg', 100)$$,
  '22023', 'invalid_path',
  'a path with no uploaded object is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'video',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/p1.jpg', 'v.mp4', 'video/mp4', 100)$$,
  '22023', 'invalid_kind',
  'an unknown kind is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'file',
      'c1c1c1c1-0000-0000-0000-000000000001/files/f4/big.pdf', 'big.pdf',
      'application/pdf', 10485761)$$,
  '22023', 'file_too_large',
  'a file over 10 MB is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'file',
      'c1c1c1c1-0000-0000-0000-000000000001/files/f5/run.exe', 'run.exe',
      'application/x-msdownload', 100)$$,
  '22023', 'file_not_allowed',
  'a disallowed file mime type is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/png.jpg', 'x.png', 'image/png', 100)$$,
  '22023', 'file_not_allowed',
  'a photo that is not image/jpeg is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/meta.jpg', 'x.jpg', 'image/jpeg', -1)$$,
  '22023', 'invalid_media',
  'a negative size is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/meta.jpg', 'x.jpg', 'image/jpeg', 100,
      0, 100)$$,
  '22023', 'invalid_media',
  'a zero width is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/meta.jpg', 'x.jpg', 'image/jpeg', 100,
      100, -5)$$,
  '22023', 'invalid_media',
  'a negative height is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/meta.jpg', '', 'image/jpeg', 100)$$,
  '22023', 'invalid_media',
  'an empty file name is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/meta.jpg', repeat('a', 256),
      'image/jpeg', 100)$$,
  '22023', 'invalid_media',
  'a file name over 255 characters is refused'
);

set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/meta.jpg', 'o.jpg', 'image/jpeg', 100)$$,
  '42501', 'not allowed',
  'a non-member cannot add media to the club'
);

set local request.jwt.claims =
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/r-owned.jpg', 'r.jpg', 'image/jpeg', 100)$$,
  '42501', 'not allowed',
  'a removed member cannot add media to the club'
);

-- ---------------------------------------------------------------------
-- Table select (RLS)
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select count(*)::int from public.club_media),
  4,
  'another member of the same club sees all four rows'
);

select throws_ok(
  $$insert into public.club_media (club_id, kind, storage_path, file_name, mime_type,
      size_bytes, uploaded_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/direct.jpg', 'd.jpg', 'image/jpeg',
      1, 'cccccccc-0000-0000-0000-000000000003')$$,
  '42501', null,
  'a member cannot insert into club_media directly'
);

set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select is(
  (select count(*)::int from public.club_media),
  0,
  'a member of another club sees no rows'
);

set local request.jwt.claims =
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

select is(
  (select count(*)::int from public.club_media),
  0,
  'a removed member sees no rows'
);

-- ---------------------------------------------------------------------
-- remove_club_media
--
-- r_media_id was captured as postgres above: neither a removed member nor an
-- outsider can see the row through RLS, so looking the id up under their
-- role would pass null and prove nothing.
-- ---------------------------------------------------------------------
select throws_ok(
  format('select public.remove_club_media(%L)', :'r_media_id'),
  '42501', 'not allowed',
  'a removed member cannot remove their own earlier upload'
);

set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  format('select public.remove_club_media(%L)', :'r_media_id'),
  '42501', 'not allowed',
  'an organizer of another club cannot remove this club''s media'
);

set local request.jwt.claims =
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';

select throws_ok(
  $$select public.remove_club_media(
      (select id from public.club_media
        where storage_path = 'c1c1c1c1-0000-0000-0000-000000000001/photos/p1.jpg'))$$,
  '42501', 'not allowed',
  'a plain member cannot remove someone else''s media'
);

select throws_ok(
  $$select public.remove_club_media('00000000-0000-0000-0000-00000000dead')$$,
  '42501', 'not allowed',
  'an unknown media id is refused the same way (no existence probe)'
);

set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select is(
  public.remove_club_media(
    (select id from public.club_media
      where storage_path = 'c1c1c1c1-0000-0000-0000-000000000001/photos/p1.jpg')),
  'c1c1c1c1-0000-0000-0000-000000000001/photos/p1.jpg',
  'the uploader removes their own row and gets its storage path back'
);

select is(
  (select count(*)::int from public.club_media
    where storage_path = 'c1c1c1c1-0000-0000-0000-000000000001/photos/p1.jpg'),
  0,
  'the removed row is gone'
);

set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  public.remove_club_media(
    (select id from public.club_media
      where storage_path = 'c1c1c1c1-0000-0000-0000-000000000001/files/f1/Rules.pdf')),
  'c1c1c1c1-0000-0000-0000-000000000001/files/f1/Rules.pdf',
  'an organizer removes another member''s file'
);

-- ---------------------------------------------------------------------
-- Storage policies
-- ---------------------------------------------------------------------
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner, owner_id)
     values ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/photos/s1.jpg',
             'bbbbbbbb-0000-0000-0000-000000000002',
             'bbbbbbbb-0000-0000-0000-000000000002') $$,
  'a member can upload under their own club''s folder'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner, owner_id)
     values ('club-media', 'c2c2c2c2-0000-0000-0000-000000000002/photos/s2.jpg',
             'bbbbbbbb-0000-0000-0000-000000000002',
             'bbbbbbbb-0000-0000-0000-000000000002') $$,
  '42501', null,
  'a member cannot upload under another club''s folder'
);

set local request.jwt.claims =
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner, owner_id)
     values ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/photos/s3.jpg',
             'dddddddd-0000-0000-0000-000000000004',
             'dddddddd-0000-0000-0000-000000000004') $$,
  '42501', null,
  'a removed member cannot upload under the club''s folder'
);

set local request.jwt.claims =
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';

select count(*)::int as member_sees from storage.objects
  where bucket_id = 'club-media'
    and name = 'c1c1c1c1-0000-0000-0000-000000000001/photos/s1.jpg' \gset

set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select count(*)::int as outsider_sees from storage.objects
  where bucket_id = 'club-media'
    and name = 'c1c1c1c1-0000-0000-0000-000000000001/photos/s1.jpg' \gset

set local request.jwt.claims =
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

select ok(
  :member_sees = 1 and :outsider_sees = 0
  and (select count(*)::int from storage.objects
        where bucket_id = 'club-media'
          and name = 'c1c1c1c1-0000-0000-0000-000000000001/photos/s1.jpg') = 0,
  'a club member can read the object; another club''s member and a removed member cannot'
);

-- The Storage API sets this flag for its own deletes; storage.protect_delete
-- refuses a direct DELETE without it, before RLS is ever consulted.
set local storage.allow_delete_query = 'true';

-- Removed member R: neither their own object (owner_id) nor the object of
-- their own club_media row.
with d as (
  delete from storage.objects
   where bucket_id = 'club-media'
     and name = 'c1c1c1c1-0000-0000-0000-000000000001/photos/r-owned.jpg'
  returning 1
)
select count(*)::int as removed_deleted from d \gset

select is(
  :removed_deleted, 0,
  'a removed member cannot delete their own object'
);

-- Organizer of another club, and a plain member of another club.
set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

with d as (
  delete from storage.objects
   where bucket_id = 'club-media'
     and name = 'c1c1c1c1-0000-0000-0000-000000000001/photos/s1.jpg'
  returning 1
)
select count(*)::int as other_org_deleted from d \gset

set local request.jwt.claims =
  '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}';

with d as (
  delete from storage.objects
   where bucket_id = 'club-media'
     and name = 'c1c1c1c1-0000-0000-0000-000000000001/photos/s1.jpg'
  returning 1
)
select count(*)::int as other_member_deleted from d \gset

select ok(
  :other_org_deleted = 0 and :other_member_deleted = 0,
  'an organizer or a member of another club cannot delete this club''s object'
);

-- Another plain member (no row, not the owner) deletes nothing; the uploader
-- (object owner) can delete their own object even with no club_media row —
-- the orphan-cleanup path and the after-remove path.
set local request.jwt.claims =
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';

with d as (
  delete from storage.objects
   where bucket_id = 'club-media'
     and name = 'c1c1c1c1-0000-0000-0000-000000000001/photos/s1.jpg'
  returning 1
)
select count(*)::int as other_deleted from d \gset

set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

with d as (
  delete from storage.objects
   where bucket_id = 'club-media'
     and name = 'c1c1c1c1-0000-0000-0000-000000000001/photos/s1.jpg'
  returning 1
)
select count(*)::int as owner_deleted from d \gset

select ok(
  :other_deleted = 0 and :owner_deleted = 1,
  'another plain member cannot delete the object; its uploader can'
);

-- The uploader of a club_media row can delete that row's object even if not
-- its storage owner; an organizer can delete any object in their club.
reset role;
update storage.objects set owner = null, owner_id = null
 where bucket_id = 'club-media'
   and name = 'c1c1c1c1-0000-0000-0000-000000000001/files/f2/sheet.xlsx';
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/photos/x9.jpg', null, null);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

with d as (
  delete from storage.objects
   where bucket_id = 'club-media'
     and name = 'c1c1c1c1-0000-0000-0000-000000000001/files/f2/sheet.xlsx'
  returning 1
)
select count(*)::int as row_uploader_deleted from d \gset

set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

with d as (
  delete from storage.objects
   where bucket_id = 'club-media'
     and name = 'c1c1c1c1-0000-0000-0000-000000000001/photos/x9.jpg'
  returning 1
)
select count(*)::int as organizer_deleted from d \gset

select ok(
  :row_uploader_deleted = 1 and :organizer_deleted = 1,
  'the uploader of a club_media row and a club organizer can each delete the object'
);

-- ---------------------------------------------------------------------
-- fetch_club_media
--
-- profiles are readable only for the caller's own row (20260822180000), so
-- uploader names have to come from this security definer RPC rather than a
-- PostgREST embed. Rows below get explicit created_at values: every row
-- inserted earlier in this transaction shares one now(), which would make
-- ordering and paging untestable. The two c1 rows left from above
-- (R's r-owned.jpg photo and B's sheet.xlsx file) carry that now(), so they
-- are newer than all of these.
-- ---------------------------------------------------------------------
reset role;
update public.profiles set display_name = 'Hana Host'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.profiles set display_name = 'Bea Member'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set display_name = 'Cal Other'
 where id = 'cccccccc-0000-0000-0000-000000000003';
update public.profiles set display_name = 'Rae Removed'
 where id = 'dddddddd-0000-0000-0000-000000000004';
update public.profiles set display_name = 'Oscar Outside'
 where id = 'eeeeeeee-0000-0000-0000-000000000005';

insert into public.club_media
  (club_id, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by, created_at)
values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
   'c1c1c1c1-0000-0000-0000-000000000001/photos/fb.jpg', 'fb.jpg', 'image/jpeg', 1,
   'bbbbbbbb-0000-0000-0000-000000000002', '2026-10-01 10:00:00+00'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
   'c1c1c1c1-0000-0000-0000-000000000001/photos/fa.jpg', 'fa.jpg', 'image/jpeg', 1,
   'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-01 11:00:00+00'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
   'c1c1c1c1-0000-0000-0000-000000000001/photos/fc.jpg', 'fc.jpg', 'image/jpeg', 1,
   'cccccccc-0000-0000-0000-000000000003', '2026-10-01 12:00:00+00'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'file',
   'c1c1c1c1-0000-0000-0000-000000000001/files/fa/notes.txt', 'notes.txt', 'text/plain', 1,
   'aaaaaaaa-0000-0000-0000-000000000001', '2026-10-01 09:00:00+00'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'photo',
   'c2c2c2c2-0000-0000-0000-000000000002/photos/fe.jpg', 'fe.jpg', 'image/jpeg', 1,
   'eeeeeeee-0000-0000-0000-000000000005', '2026-10-01 13:00:00+00');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';

select is(
  (select uploader_name from public.fetch_club_media(
      'c1c1c1c1-0000-0000-0000-000000000001', 'photo')
    where storage_path = 'c1c1c1c1-0000-0000-0000-000000000001/photos/fb.jpg'),
  'Bea Member',
  'a member sees another member''s name as the uploader'
);

select is(
  (select array_agg(uploader_name || ':' || file_name order by f.ordinality)
     from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo')
       with ordinality as f),
  array['Rae Removed:r.jpg', 'Cal Other:fc.jpg', 'Hana Host:fa.jpg', 'Bea Member:fb.jpg'],
  'photos come back newest first, only this club''s, each with its uploader''s name'
);

select is(
  (select array_agg(kind || ':' || file_name order by f.ordinality)
     from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'file')
       with ordinality as f),
  array['file:sheet.xlsx', 'file:notes.txt'],
  'the file kind returns only files'
);

select is(
  (select count(*)::int
     from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo')
    where kind <> 'photo'),
  0,
  'the photo kind returns no files'
);

select is(
  (select array_agg(file_name order by f.ordinality)
     from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
       '2026-10-01 12:00:00+00')
       with ordinality as f),
  array['fa.jpg', 'fb.jpg'],
  'p_before pages to rows strictly older than the cursor'
);

select is(
  (select array_agg(file_name order by f.ordinality)
     from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
       null, 2)
       with ordinality as f),
  array['r.jpg', 'fc.jpg'],
  'p_limit caps the page'
);

select is(
  (select count(*)::int
     from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
       null, 100000)),
  4,
  'an oversized p_limit is clamped rather than refused'
);

select throws_ok(
  $$select * from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'video')$$,
  '22023', 'invalid_kind',
  'fetch_club_media refuses an unknown kind'
);

set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$select * from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo')$$,
  '42501', 'not allowed',
  'a non-member cannot list the club''s media'
);

set local request.jwt.claims =
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$select * from public.fetch_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo')$$,
  '42501', 'not allowed',
  'a removed member cannot list the club''s media'
);

select * from finish();
rollback;
