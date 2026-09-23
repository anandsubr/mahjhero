begin;
set local search_path to extensions, public;
select plan(4);

select has_column('public', 'club_invites', 'event_id', 'club_invites has event_id');

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ef01', 'ci-host@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ef01', 'Invite Event Club',
   'invite-event-club', 'aaaaaaaa-0000-0000-0000-00000000ef01'),
  ('c2c2c2c2-0000-0000-0000-00000000ef02', 'Other Club', 'other-club-ci',
   'aaaaaaaa-0000-0000-0000-00000000ef01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ef01',
   'aaaaaaaa-0000-0000-0000-00000000ef01', 'host'),
  ('c2c2c2c2-0000-0000-0000-00000000ef02',
   'aaaaaaaa-0000-0000-0000-00000000ef01', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000ef01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000ef01',
   'aaaaaaaa-0000-0000-0000-00000000ef01');

insert into public.events (id, club_id, title, venue_id, starts_at, ends_at, created_by) values
  ('22222222-0000-0000-0000-00000000ef01', 'c1c1c1c1-0000-0000-0000-00000000ef01',
   'Test Game', '11111111-0000-0000-0000-00000000ef01',
   now() + interval '1 day', now() + interval '1 day 3 hours',
   'aaaaaaaa-0000-0000-0000-00000000ef01');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000ef01", "role": "authenticated"}';

-- Invite creation now goes through create_club_invite (Task 2), not a raw
-- INSERT -- club_invites no longer grants INSERT to authenticated at all.
-- The caller organizes BOTH clubs in this fixture, so assert_club_organizer
-- passes for either target_club_id; the event-matches-club TRIGGER is what
-- these three cases are actually exercising.
select lives_ok(
  $$select public.create_club_invite(
      'c1c1c1c1-0000-0000-0000-00000000ef01', 'guest1@example.com', '',
      '22222222-0000-0000-0000-00000000ef01')$$,
  'an invite tied to an event of the SAME club is accepted'
);

select throws_ok(
  $$select public.create_club_invite(
      'c2c2c2c2-0000-0000-0000-00000000ef02', 'guest2@example.com', '',
      '22222222-0000-0000-0000-00000000ef01')$$,
  '23514',
  null,
  'an invite cannot tie a DIFFERENT club to this event'
);

select lives_ok(
  $$select public.create_club_invite(
      'c1c1c1c1-0000-0000-0000-00000000ef01', 'guest3@example.com', '', null)$$,
  'a plain club invite with no event_id is still accepted'
);

select * from finish();
rollback;
