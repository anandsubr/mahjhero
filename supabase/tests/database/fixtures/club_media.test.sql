begin;
set local search_path to extensions, public;

select plan(34);

-- Club 1 (c1): host H, members M and P, removed member R.
-- Club 2 (c2): host O (an outsider to c1).
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'host@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'member@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'other-member@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'removed@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'outsider@example.com');

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
   'eeeeeeee-0000-0000-0000-000000000005', 'host', 'active');

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
  'a member can add a photo'
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
      'c1c1c1c1-0000-0000-0000-000000000001/files/p2.jpg', 'x.jpg', 'image/jpeg', 100)$$,
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
      'c1c1c1c1-0000-0000-0000-000000000001/photos/f3/a.pdf', 'a.pdf', 'application/pdf', 100)$$,
  '22023', 'invalid_path',
  'a file outside the club''s files/ folder is refused'
);

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'video',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/v.mp4', 'v.mp4', 'video/mp4', 100)$$,
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
  'a disallowed mime type is refused'
);

set local request.jwt.claims =
  '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/o1.jpg', 'o.jpg', 'image/jpeg', 100)$$,
  '42501', 'not allowed',
  'a non-member cannot add media to the club'
);

set local request.jwt.claims =
  '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

select throws_ok(
  $$select public.add_club_media('c1c1c1c1-0000-0000-0000-000000000001', 'photo',
      'c1c1c1c1-0000-0000-0000-000000000001/photos/r1.jpg', 'r.jpg', 'image/jpeg', 100)$$,
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
  3,
  'another member of the same club sees all three rows'
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
-- ---------------------------------------------------------------------
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

-- Delete policy: another plain member (no row, not the owner) deletes nothing;
-- the uploader (object owner) can delete their own object even with no
-- club_media row — the orphan-cleanup path and the after-remove path.
-- The Storage API sets this flag for its own deletes; storage.protect_delete
-- refuses a direct DELETE without it, before RLS is ever consulted.
set local storage.allow_delete_query = 'true';
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

-- An organizer can delete any object in their club's folder; the uploader of
-- a club_media row can delete that row's object even if not its storage owner.
reset role;
insert into storage.objects (bucket_id, name, owner, owner_id) values
  ('club-media', 'c1c1c1c1-0000-0000-0000-000000000001/files/f2/sheet.xlsx', null, null),
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

select * from finish();
rollback;
