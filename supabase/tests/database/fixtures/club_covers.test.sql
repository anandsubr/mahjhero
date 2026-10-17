begin;
set local search_path to extensions, public;

select plan(16);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'host@example.com'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'member@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'outsider@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Riverside Mah Jongg', 'riverside',
   'America/New_York', 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'host', 'active'),
  ('c1c1c1c1-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'member', 'active');

select is(
  (select cover_color from public.clubs where id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  'accent2_800',
  'a club inserted without a cover colour defaults to accent2_800'
);

select throws_ok(
  $$update public.clubs set cover_color = 'pink' where id = 'c1c1c1c1-0000-0000-0000-000000000001'$$,
  '23514', null,
  'the cover colour check constraint refuses an unknown token'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$select public.set_club_cover_color('c1c1c1c1-0000-0000-0000-000000000001', 'accent_700')$$,
  'the host can set the cover colour'
);

select is(
  (select cover_color from public.clubs where id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  'accent_700',
  'the new cover colour is actually stored'
);

set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$select public.set_club_cover_color('c1c1c1c1-0000-0000-0000-000000000001', 'accent_800')$$,
  '42501', null,
  'a plain member cannot set the cover colour'
);

set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select is(
  public.set_club_cover('c1c1c1c1-0000-0000-0000-000000000001',
    'c1c1c1c1-0000-0000-0000-000000000001/x.jpg'),
  null,
  'the first set_club_cover call returns null (no previous path) and stores the path'
);

select is(
  public.set_club_cover('c1c1c1c1-0000-0000-0000-000000000001',
    'c1c1c1c1-0000-0000-0000-000000000001/y.jpg'),
  'c1c1c1c1-0000-0000-0000-000000000001/x.jpg',
  'the second set_club_cover call returns the previous path'
);

select throws_ok(
  $$select public.set_club_cover('c1c1c1c1-0000-0000-0000-000000000001',
      'wrong-prefix/z.jpg')$$,
  '22023', 'invalid_path',
  'a path not prefixed by the club id is refused'
);

select is(
  public.set_club_cover('c1c1c1c1-0000-0000-0000-000000000001', null),
  'c1c1c1c1-0000-0000-0000-000000000001/y.jpg',
  'passing null clears the cover path (and still returns the previous one)'
);

select is(
  (select cover_path from public.clubs where id = 'c1c1c1c1-0000-0000-0000-000000000001'),
  null,
  'the cover path is actually cleared to null'
);

select throws_ok(
  $$update public.clubs set cover_color = 'accent_800'
      where id = 'c1c1c1c1-0000-0000-0000-000000000001'$$,
  '42501', null,
  'a host cannot change the cover colour with a direct UPDATE'
);

select throws_ok(
  $$update public.clubs set cover_path = 'c1c1c1c1-0000-0000-0000-000000000001/direct.jpg'
      where id = 'c1c1c1c1-0000-0000-0000-000000000001'$$,
  '42501', null,
  'a host cannot change the cover path with a direct UPDATE'
);

-- storage write policies (club_covers_insert): organizer-only, folder-scoped.
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('club-covers', 'c1c1c1c1-0000-0000-0000-000000000001/m.jpg',
             'bbbbbbbb-0000-0000-0000-000000000002') $$,
  '42501',
  null,
  'a plain member cannot insert into the club''s own cover folder'
);

set local request.jwt.claims =
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('club-covers', 'd1d1d1d1-0000-0000-0000-000000000001/x.jpg',
             'aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'an organizer of one club cannot insert under a different club''s folder'
);

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner)
     values ('club-covers', 'c1c1c1c1-0000-0000-0000-000000000001/host-upload.jpg',
             'aaaaaaaa-0000-0000-0000-000000000001') $$,
  'an organizer can insert under their own club''s folder'
);

reset role;
insert into storage.objects (bucket_id, name, owner) values
  ('club-covers', 'c1c1c1c1-0000-0000-0000-000000000001/a.jpg',
   'aaaaaaaa-0000-0000-0000-000000000001');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select count(*)::int as member_sees from storage.objects
  where bucket_id = 'club-covers'
    and name = 'c1c1c1c1-0000-0000-0000-000000000001/a.jpg' \gset

set local request.jwt.claims =
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';

-- One assertion covering both halves of the storage policy check: a member
-- sees the row (captured above, before the role switch), a non-member does
-- not (checked live, under the non-member's own role).
select ok(
  :member_sees = 1
  and (select count(*)::int from storage.objects
        where bucket_id = 'club-covers'
          and name = 'c1c1c1c1-0000-0000-0000-000000000001/a.jpg') = 0,
  'a club member can select the cover object; a non-member sees nothing'
);

select * from finish();
rollback;
