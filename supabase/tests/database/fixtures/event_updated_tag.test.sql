begin;
set local search_path to extensions, public;

select plan(45);

/*
 * The "Updated" tag (phase 6): events.details_changed_at, event_views,
 * mark_event_seen, and the `updated` column on my_games / club_games.
 *
 * Inside one transaction now() is constant, so "an hour after creation" and
 * "a later edit than the last view" are set up by backdating created_at and
 * seen_at directly as postgres rather than by waiting.
 *
 * People: H hosts club C1; M and I are members; O belongs only to C2.
 */

insert into auth.users (id, email) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'host@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'member@example.com'),
  ('dddddddd-0000-0000-0000-000000000004', 'invitee@example.com'),
  ('cccccccc-0000-0000-0000-000000000003', 'outsider@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Mine', 'mine', 'America/New_York',
   'bbbbbbbb-0000-0000-0000-000000000002'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'Other', 'other', 'UTC',
   'cccccccc-0000-0000-0000-000000000003');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'member'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000004', 'member'),
  ('c2c2c2c2-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('11111111-0000-0000-0000-000000000002', 'The Annex',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');

-- One-off games, all 19:00 club time two days out, all created a day ago
-- except "Fresh". "Past" and "Old change" carry their change stamp already.
insert into public.events
  (id, club_id, title, venue_id, notes, starts_at, ends_at, created_by,
   seating_mode, capacity, game_mode, created_at, details_changed_at)
select v.id::uuid, 'c1c1c1c1-0000-0000-0000-000000000001', v.title,
       '11111111-0000-0000-0000-000000000001', 'Bring tiles',
       ((current_date + 2) + time '19:00') at time zone 'America/New_York' + v.shift,
       ((current_date + 2) + time '22:00') at time zone 'America/New_York' + v.shift,
       'bbbbbbbb-0000-0000-0000-000000000002', 'open_seating', 4, v.mode::public.game_mode,
       now() - v.age, v.changed
from (values
  ('e1000000-0000-0000-0000-000000000001', 'Time edit',      interval '0', 'open_play',   interval '1 day',   null::timestamptz),
  ('e2000000-0000-0000-0000-000000000002', 'Capacity only',  interval '0', 'open_play',   interval '1 day',   null),
  ('e3000000-0000-0000-0000-000000000003', 'Same values',    interval '0', 'open_play',   interval '1 day',   null),
  ('e4000000-0000-0000-0000-000000000004', 'Venue edit',     interval '0', 'open_play',   interval '1 day',   null),
  ('e5000000-0000-0000-0000-000000000005', 'Notes edit',     interval '0', 'open_play',   interval '1 day',   null),
  ('e6000000-0000-0000-0000-000000000006', 'Title edit',     interval '0', 'open_play',   interval '1 day',   null),
  ('e7000000-0000-0000-0000-000000000007', 'Fresh',          interval '0', 'open_play',   interval '0',       null),
  ('e8000000-0000-0000-0000-000000000008', 'Past',           interval '-3 days', 'open_play', interval '10 days', now() - interval '2 days'),
  ('e9000000-0000-0000-0000-000000000009', 'Old change',     interval '0', 'open_play',   interval '30 days', now() - interval '15 days'),
  ('ea000000-0000-0000-0000-00000000000a', 'Secret',         interval '0', 'invite_only', interval '1 day',   null)
) v(id, title, shift, mode, age, changed);

-- M is confirmed on "Time edit" (so it is in M's my_games); I holds an
-- unanswered invite on the invite-only "Secret".
insert into public.booking_groups (id, event_id, club_id, created_by, status) values
  ('99000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed'),
  ('99000000-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-00000000000a',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed');

insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status, invite_holds_seat)
values
  ('99000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'confirmed', null),
  ('99000000-0000-0000-0000-00000000000a', 'ea000000-0000-0000-0000-00000000000a',
   'c1c1c1c1-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000004',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true);

-- ---------------------------------------------------------------------------
-- Schema.
-- ---------------------------------------------------------------------------
select has_column('public', 'events', 'details_changed_at', 'events has details_changed_at');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.event_views'::regclass),
  'event_views has RLS on'
);
select ok(
  not has_table_privilege('authenticated', 'public.event_views',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'authenticated has no direct access to event_views'
);
select ok(
  not has_function_privilege('anon', 'public.mark_event_seen(uuid)', 'EXECUTE'),
  'anon cannot execute mark_event_seen'
);
select ok(
  has_function_privilege('authenticated', 'public.mark_event_seen(uuid)', 'EXECUTE'),
  'authenticated can execute mark_event_seen'
);

-- ---------------------------------------------------------------------------
-- update_event: only detail changes stamp details_changed_at.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select public.update_event('e1000000-0000-0000-0000-000000000001', new_start_time => '20:00');
select public.update_event('e2000000-0000-0000-0000-000000000002', new_capacity => 8);
select public.update_event('e3000000-0000-0000-0000-000000000003',
  new_title => ' Same values ', new_venue_id => '11111111-0000-0000-0000-000000000001',
  new_notes => 'Bring tiles  ', new_date => current_date + 2, new_start_time => '19:00',
  new_duration_minutes => 180);
select public.update_event('e4000000-0000-0000-0000-000000000004',
  new_venue_id => '11111111-0000-0000-0000-000000000002');
select public.update_event('e5000000-0000-0000-0000-000000000005', new_notes => 'Bring snacks');
select public.update_event('e6000000-0000-0000-0000-000000000006', new_title => 'Title edited');
select public.update_event('e7000000-0000-0000-0000-000000000007', new_title => 'Fresh, renamed');

reset role;

select is((select details_changed_at from public.events where id = 'e1000000-0000-0000-0000-000000000001'),
  now(), 'a time edit stamps details_changed_at');
select is((select details_changed_at from public.events where id = 'e2000000-0000-0000-0000-000000000002'),
  null, 'a capacity-only edit leaves details_changed_at null');
select is((select capacity from public.events where id = 'e2000000-0000-0000-0000-000000000002'),
  8, 'and the capacity edit still happened');
select is((select details_changed_at from public.events where id = 'e3000000-0000-0000-0000-000000000003'),
  null, 'a save with identical values (modulo whitespace) leaves it null');
select is((select details_changed_at from public.events where id = 'e4000000-0000-0000-0000-000000000004'),
  now(), 'a venue edit stamps it');
select is((select details_changed_at from public.events where id = 'e5000000-0000-0000-0000-000000000005'),
  now(), 'a notes edit stamps it');
select is((select details_changed_at from public.events where id = 'e6000000-0000-0000-0000-000000000006'),
  now(), 'a title edit stamps it');
select is((select details_changed_at from public.events where id = 'e7000000-0000-0000-0000-000000000007'),
  now(), 'an edit to a fresh game stamps it too');

-- ---------------------------------------------------------------------------
-- my_games / club_games `updated` for M.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select updated from public.club_games('c1c1c1c1-0000-0000-0000-000000000001',
     now() - interval '7 days', now() + interval '30 days') where title = 'Fresh, renamed'),
  false, 'a game created and edited within the hour is not updated');
select is(
  (select updated from public.club_games('c1c1c1c1-0000-0000-0000-000000000001',
     now() - interval '7 days', now() + interval '30 days') where title = 'Time edit'),
  true, 'club_games: a game edited more than an hour after creation is updated');
select is(
  (select updated from public.my_games(now() - interval '7 days', now() + interval '30 days')
   where title = 'Time edit'),
  true, 'my_games: the same game is updated');

-- The editor never sees Updated for their own edit.
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select is(
  (select updated from public.club_games('c1c1c1c1-0000-0000-0000-000000000001',
     now() - interval '7 days', now() + interval '30 days') where title = 'Time edit'),
  false, 'club_games: the host who made the edit does not see it as updated');
select is(
  (select updated from public.my_games(now() - interval '7 days', now() + interval '30 days')
   where title = 'Time edit'),
  false, 'my_games: nor in their own hosting list');
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';
select is(
  (select updated from public.club_games('c1c1c1c1-0000-0000-0000-000000000001',
     now() - interval '7 days', now() + interval '30 days') where title = 'Capacity only'),
  false, 'a capacity-only edit is not updated');
select is(
  (select updated from public.club_games('c1c1c1c1-0000-0000-0000-000000000001',
     now() - interval '7 days', now() + interval '30 days') where title = 'Past'),
  false, 'a past game is never updated');
select is(
  (select updated from public.club_games('c1c1c1c1-0000-0000-0000-000000000001',
     now() - interval '7 days', now() + interval '30 days') where title = 'Old change'),
  false, 'a change older than 14 days is not updated');

select lives_ok($$select public.mark_event_seen('e1000000-0000-0000-0000-000000000001')$$,
  'a member can mark a game seen');
select is(
  (select updated from public.club_games('c1c1c1c1-0000-0000-0000-000000000001',
     now() - interval '7 days', now() + interval '30 days') where title = 'Time edit'),
  false, 'club_games: after mark_event_seen it is no longer updated');
select is(
  (select updated from public.my_games(now() - interval '7 days', now() + interval '30 days')
   where title = 'Time edit'),
  false, 'my_games: after mark_event_seen it is no longer updated');

-- The view happened ten minutes ago; the host edits again now.
reset role;
update public.event_views set seen_at = now() - interval '10 minutes'
  where event_id = 'e1000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select public.update_event('e1000000-0000-0000-0000-000000000001', new_title => 'Time edit, again');
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select updated from public.club_games('c1c1c1c1-0000-0000-0000-000000000001',
     now() - interval '7 days', now() + interval '30 days') where title = 'Time edit, again'),
  true, 'a later edit brings updated back');
select lives_ok($$select public.mark_event_seen('e1000000-0000-0000-0000-000000000001')$$,
  'marking seen again (upsert) succeeds');
select is(
  (select updated from public.my_games(now() - interval '7 days', now() + interval '30 days')
   where title = 'Time edit, again'),
  false, 'and clears it again');

-- ---------------------------------------------------------------------------
-- mark_event_seen access: whoever can read the game.
-- ---------------------------------------------------------------------------
select throws_ok($$select public.mark_event_seen('ea000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'a member cannot mark an invite-only game they cannot see');
set local request.jwt.claims = '{"sub": "dddddddd-0000-0000-0000-000000000004", "role": "authenticated"}';
select lives_ok($$select public.mark_event_seen('ea000000-0000-0000-0000-00000000000a')$$,
  'an invitee can mark the invite-only game seen');
set local request.jwt.claims = '{"sub": "cccccccc-0000-0000-0000-000000000003", "role": "authenticated"}';
select throws_ok($$select public.mark_event_seen('e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a non-member cannot mark a game seen');
reset role;

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-000000000005', 'removed@example.com');
insert into public.club_members (club_id, profile_id, role, status) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000005', 'member', 'removed');
set local role authenticated;
set local request.jwt.claims = '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';
select throws_ok($$select public.mark_event_seen('e1000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a removed member cannot mark a game seen');
reset role;

-- ---------------------------------------------------------------------------
-- update_event_series: future occurrences whose time changes are stamped;
-- past and hand-set ones are not; a capacity-only series edit stamps none.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select public.create_event_series(
  'c1c1c1c1-0000-0000-0000-000000000001', 'Weekly', '11111111-0000-0000-0000-000000000001',
  'Series notes', 'weekly', extract(dow from current_date + 1)::smallint, null,
  '19:00'::time, 180, 1, current_date + 1, current_date + 60,
  series_seating_mode => 'open_seating', capacity_limit => 4);
reset role;

insert into public.events
  (club_id, series_id, title, venue_id, notes, starts_at, ends_at, occurrence_date, created_by, created_at)
select 'c1c1c1c1-0000-0000-0000-000000000001', s.id, 'Weekly', s.venue_id, 'Series notes',
       ((current_date - 6) + time '19:00') at time zone 'America/New_York',
       ((current_date - 6) + time '22:00') at time zone 'America/New_York',
       current_date - 6, 'bbbbbbbb-0000-0000-0000-000000000002', now() - interval '10 days'
from public.event_series s where s.title = 'Weekly';

update public.events set overrides = '{starts_at}'
  where title = 'Weekly' and occurrence_date = current_date + 8;

set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select public.update_event_series(
  (select id from public.event_series where title = 'Weekly'), new_capacity => 6);
reset role;

select is(
  (select count(*)::int from public.events
   where title = 'Weekly' and details_changed_at is not null),
  0, 'a capacity-only series edit stamps no occurrence');

set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select public.update_event_series(
  (select id from public.event_series where title = 'Weekly'), new_start_time => '20:00');
reset role;

select is(
  (select count(*)::int from public.events
   where title = 'Weekly' and starts_at > now() and occurrence_date <> current_date + 8
     and details_changed_at is distinct from now()),
  0, 'a series time edit stamps every changed future occurrence');
select ok(
  (select count(*) from public.events
   where title = 'Weekly' and starts_at > now() and occurrence_date <> current_date + 8) > 0,
  'and there were such occurrences');
select is(
  (select details_changed_at from public.events
   where title = 'Weekly' and occurrence_date = current_date + 8),
  null, 'a hand-set occurrence the edit skipped is not stamped');
select is(
  (select details_changed_at from public.events
   where title = 'Weekly' and occurrence_date = current_date - 6),
  null, 'a past occurrence is not stamped');

-- An occurrence that already holds the new value stays unstamped, even when
-- the edit reaches overridden weeks. +22 is hand-set to 21:00 already.
update public.events set
  starts_at = ((current_date + 22) + time '21:00') at time zone 'America/New_York',
  ends_at   = ((current_date + 22) + time '21:00') at time zone 'America/New_York' + interval '3 hours',
  overrides = '{starts_at}', details_changed_at = null
  where series_id is not null and occurrence_date = current_date + 22;

set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select public.update_event_series((select id from public.event_series limit 1),
  new_start_time => '21:00', include_overridden => true);
reset role;

select is(
  (select details_changed_at from public.events
   where series_id is not null and occurrence_date = current_date + 22),
  null, 'an occurrence already at the new time is not stamped');
select is(
  (select details_changed_at from public.events
   where series_id is not null and occurrence_date = current_date + 8),
  now(), 'the overridden week the edit now reaches is stamped');

-- reset_event_to_series: stamps when the reset changes a detail, not otherwise.
update public.events set title = 'Hand title', overrides = '{title}', details_changed_at = null
  where series_id is not null and occurrence_date = current_date + 29;
update public.events set capacity = 9, overrides = '{capacity}', details_changed_at = null
  where series_id is not null and occurrence_date = current_date + 36;

set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select public.reset_event_to_series(
  (select id from public.events where series_id is not null and occurrence_date = current_date + 29));
select public.reset_event_to_series(
  (select id from public.events where series_id is not null and occurrence_date = current_date + 36));
reset role;

select is(
  (select details_changed_at from public.events
   where series_id is not null and occurrence_date = current_date + 29),
  now(), 'a reset that restores the title stamps the occurrence');
select is(
  (select v.seen_at from public.event_views v join public.events e on e.id = v.event_id
   where e.series_id is not null and e.occurrence_date = current_date + 29
     and v.profile_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  now(), 'and the host who reset it has seen it');
select is(
  (select details_changed_at from public.events
   where series_id is not null and occurrence_date = current_date + 36),
  null, 'a reset that changes only capacity does not stamp');

-- Series title, venue and notes edits each stamp every future occurrence and
-- no past one. The stamps are cleared before each edit.
update public.events set details_changed_at = null where series_id is not null;
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select public.update_event_series((select id from public.event_series limit 1), new_title => 'Weekly renamed');
reset role;
select is(
  (select count(*) filter (where starts_at > now() and details_changed_at is distinct from now())
        + count(*) filter (where starts_at <= now() and details_changed_at is not null)
   from public.events where series_id is not null)::int,
  0, 'a series title edit stamps every future occurrence and no past one');
select is(
  (select count(*)::int from public.event_views v join public.events e on e.id = v.event_id
   where e.series_id is not null and e.details_changed_at = now()
     and v.profile_id = 'bbbbbbbb-0000-0000-0000-000000000002' and v.seen_at = now())
  - (select count(*)::int from public.events where series_id is not null and details_changed_at = now()),
  0, 'and the host who made the series edit has seen every stamped occurrence');

update public.events set details_changed_at = null where series_id is not null;
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select public.update_event_series((select id from public.event_series limit 1),
  new_venue_id => '11111111-0000-0000-0000-000000000002');
reset role;
select is(
  (select count(*) filter (where starts_at > now() and details_changed_at is distinct from now())
        + count(*) filter (where starts_at <= now() and details_changed_at is not null)
   from public.events where series_id is not null)::int,
  0, 'a series venue edit stamps every future occurrence and no past one');

update public.events set details_changed_at = null where series_id is not null;
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';
select public.update_event_series((select id from public.event_series limit 1), new_notes => 'New notes');
reset role;
select is(
  (select count(*) filter (where starts_at > now() and details_changed_at is distinct from now())
        + count(*) filter (where starts_at <= now() and details_changed_at is not null)
   from public.events where series_id is not null)::int,
  0, 'a series notes edit stamps every future occurrence and no past one');

select * from finish();
rollback;
