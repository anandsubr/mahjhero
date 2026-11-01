begin;
set local search_path to extensions, public;

select plan(46);

/*
 * Optional game name (20261021100000_optional_game_name.sql).
 *
 * events.title / event_series.title may be NULL; a blank or whitespace
 * title is stored as NULL, never as ''. create_event / create_event_series
 * accept a null or blank title. update_event / update_event_series keep
 * "new_title null = leave it alone" and add "new_title '' (or whitespace) =
 * clear it to NULL"; a change to or from NULL stamps details_changed_at, a
 * no-op does not. Feeds that hand the client a finished string use
 * event_headline(): the trimmed title, else 'Private game' for an
 * invite-only game, else 'Open play'. my_games / club_games pass NULL
 * through (the client formats it with lib/home.ts gameHeadline).
 *
 * Inside one transaction now() is constant, so "was it stamped" is
 * details_changed_at = now().
 *
 * People: H hosts club C1; M is a member; N is invited to C1 by email only.
 */

insert into auth.users (id, email) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'host@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'member@example.com'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'newbie@example.com');

insert into public.clubs (id, name, slug, timezone, created_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'Mine', 'mine', 'America/New_York',
   'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'host'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'member');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-000000000001', 'The Hall',
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- Schema.
-- ---------------------------------------------------------------------------
select col_is_null('public', 'events', 'title', 'events.title is nullable');
select col_is_null('public', 'event_series', 'title', 'event_series.title is nullable');

select throws_ok(
  $$insert into public.events (club_id, title, venue_id, starts_at, ends_at, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', '   ',
            '11111111-0000-0000-0000-000000000001', now() + interval '1 day',
            now() + interval '1 day 3 hours', 'bbbbbbbb-0000-0000-0000-000000000002')$$,
  '23514', null,
  'a blank title still cannot be stored directly -- blank means NULL'
);
select throws_ok(
  $$insert into public.event_series
      (club_id, title, venue_id, frequency, weekday, start_time, starts_on, created_by)
    values ('c1c1c1c1-0000-0000-0000-000000000001', '',
            '11111111-0000-0000-0000-000000000001', 'weekly', 2, '19:00',
            current_date, 'bbbbbbbb-0000-0000-0000-000000000002')$$,
  '23514', null,
  'a blank series title cannot be stored directly either'
);

-- event_headline: the SQL twin of lib/home.ts gameHeadline.
select is(public.event_headline(' Tuesday ', 'open_play'), 'Tuesday', 'event_headline trims a real name');
select is(public.event_headline(null, 'open_play'), 'Open play', 'event_headline: unnamed open game');
select is(public.event_headline('  ', 'invite_only'), 'Private game', 'event_headline: blank invite-only game');
select is(public.event_headline(null, null), null, 'event_headline: no game at all stays NULL');
select ok(
  not has_function_privilege('authenticated', 'public.event_headline(text, public.game_mode)', 'EXECUTE'),
  'event_headline is internal: authenticated cannot execute it'
);
select ok(
  not has_function_privilege('anon', 'public.event_headline(text, public.game_mode)', 'EXECUTE'),
  'anon cannot execute event_headline'
);

-- ---------------------------------------------------------------------------
-- Create, as the host.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

create temporary table ids (k text primary key, id uuid) on commit drop;
grant all on ids to authenticated;

insert into ids values
  ('null_one', public.create_event(
     'c1c1c1c1-0000-0000-0000-000000000001', null,
     '11111111-0000-0000-0000-000000000001',
     event_date => current_date + 3, start_time => '19:00')),
  ('blank_one', public.create_event(
     'c1c1c1c1-0000-0000-0000-000000000001', '   ',
     '11111111-0000-0000-0000-000000000001',
     event_date => current_date + 3, start_time => '19:00',
     event_game_mode => 'invite_only')),
  ('named_one', public.create_event(
     'c1c1c1c1-0000-0000-0000-000000000001', ' Named night ',
     '11111111-0000-0000-0000-000000000001',
     event_date => current_date + 3, start_time => '19:00')),
  ('null_series', public.create_event_series(
     'c1c1c1c1-0000-0000-0000-000000000001', null,
     '11111111-0000-0000-0000-000000000001')),
  ('blank_series', public.create_event_series(
     'c1c1c1c1-0000-0000-0000-000000000001', '  ',
     '11111111-0000-0000-0000-000000000001')),
  ('named_series', public.create_event_series(
     'c1c1c1c1-0000-0000-0000-000000000001', 'Weekly',
     '11111111-0000-0000-0000-000000000001'));

select is((select title from public.events where id = (select id from ids where k = 'null_one')),
  null, 'create_event with a null title stores NULL');
select is((select title from public.events where id = (select id from ids where k = 'blank_one')),
  null, 'create_event with a whitespace title stores NULL, not ''''');
select is((select title from public.events where id = (select id from ids where k = 'named_one')),
  'Named night', 'create_event still trims and keeps a real name');

select is((select title from public.event_series where id = (select id from ids where k = 'null_series')),
  null, 'create_event_series with a null title stores NULL');
select is((select title from public.event_series where id = (select id from ids where k = 'blank_series')),
  null, 'create_event_series with a blank title stores NULL');
select ok(
  (select count(*) > 0 from public.events where series_id = (select id from ids where k = 'null_series')),
  'an unnamed series still materializes occurrences'
);
select is(
  (select count(*)::int from public.events
    where series_id = (select id from ids where k = 'null_series') and title is not null),
  0, 'every occurrence of an unnamed series is unnamed'
);

-- ---------------------------------------------------------------------------
-- update_event: '' clears, null leaves alone; to/from NULL stamps.
-- ---------------------------------------------------------------------------
-- Backdate creation so the stamp is not confused with set-up (it is compared
-- directly here anyway), and clear any stamp so each assertion starts clean.
reset role;
update public.events set created_at = now() - interval '1 day', details_changed_at = null;
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

-- null = leave alone, on a named game.
select public.update_event((select id from ids where k = 'named_one'), new_capacity => 9);
select is((select title from public.events where id = (select id from ids where k = 'named_one')),
  'Named night', 'update_event with new_title null leaves the name alone');
select is((select details_changed_at from public.events where id = (select id from ids where k = 'named_one')),
  null, '... and does not stamp');

-- '' = clear.
select public.update_event((select id from ids where k = 'named_one'), new_title => '');
select is((select title from public.events where id = (select id from ids where k = 'named_one')),
  null, 'update_event with new_title '''' clears the name to NULL');
select is((select details_changed_at from public.events where id = (select id from ids where k = 'named_one')),
  now(), 'clearing the name stamps details_changed_at');

-- Whitespace clears too; on an already-unnamed game it is a no-op.
select public.update_event((select id from ids where k = 'null_one'), new_title => '   ');
select is((select title from public.events where id = (select id from ids where k = 'null_one')),
  null, 'clearing an already-unnamed game keeps NULL');
select is((select details_changed_at from public.events where id = (select id from ids where k = 'null_one')),
  null, 'clearing an already-unnamed game does not stamp');

-- A no-op save on an unnamed game (null = leave alone, other fields equal).
select public.update_event((select id from ids where k = 'null_one'),
  new_title => null, new_venue_id => '11111111-0000-0000-0000-000000000001', new_notes => '');
select is((select details_changed_at from public.events where id = (select id from ids where k = 'null_one')),
  null, 'a no-op save on an unnamed game does not stamp');
select is((select title from public.events where id = (select id from ids where k = 'null_one')),
  null, '... and leaves it unnamed');

-- Naming an unnamed game.
select public.update_event((select id from ids where k = 'blank_one'), new_title => ' Now named ');
select is((select title from public.events where id = (select id from ids where k = 'blank_one')),
  'Now named', 'update_event can name an unnamed game (trimmed)');
select is((select details_changed_at from public.events where id = (select id from ids where k = 'blank_one')),
  now(), 'naming an unnamed game stamps details_changed_at');

-- A series occurrence cleared on its own records the title override.
select public.update_event(
  (select id from public.events where series_id = (select id from ids where k = 'named_series')
      and starts_at > now() order by starts_at limit 1),
  new_title => '');
select ok(
  (select 'title' = any(overrides) and title is null from public.events
    where series_id = (select id from ids where k = 'named_series')
      and starts_at > now() order by starts_at limit 1),
  'clearing one occurrence''s name records a title override'
);

-- ---------------------------------------------------------------------------
-- update_event_series: '' clears the series and its occurrences.
-- ---------------------------------------------------------------------------
reset role;
update public.events set details_changed_at = null
 where series_id = (select id from ids where k = 'named_series');
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select public.update_event_series((select id from ids where k = 'named_series'), new_capacity => 9);
select is((select title from public.event_series where id = (select id from ids where k = 'named_series')),
  'Weekly', 'update_event_series with new_title null leaves the name alone');

select public.update_event_series((select id from ids where k = 'named_series'), new_title => '');
select is((select title from public.event_series where id = (select id from ids where k = 'named_series')),
  null, 'update_event_series with new_title '''' clears the series name');
select is(
  (select count(*)::int from public.events
    where series_id = (select id from ids where k = 'named_series')
      and starts_at > now() and not ('title' = any(overrides)) and title is not null),
  0, 'the cleared name reaches every non-overridden occurrence'
);
select ok(
  (select bool_and(details_changed_at = now()) from public.events
    where series_id = (select id from ids where k = 'named_series')
      and starts_at > now() and not ('title' = any(overrides))),
  'every occurrence whose name was cleared is stamped'
);

select public.update_event_series((select id from ids where k = 'null_series'), new_title => 'Named later');
select is((select title from public.event_series where id = (select id from ids where k = 'null_series')),
  'Named later', 'update_event_series can name an unnamed series');
select is(
  (select count(*)::int from public.events
    where series_id = (select id from ids where k = 'null_series') and starts_at > now() and title is distinct from 'Named later'),
  0, 'naming an unnamed series names its occurrences'
);

-- reset_event_to_series copies a NULL series title back onto an occurrence.
select public.reset_event_to_series(
  (select id from public.events where series_id = (select id from ids where k = 'named_series')
      and starts_at > now() order by starts_at limit 1));
select is(
  (select title from public.events where series_id = (select id from ids where k = 'named_series')
      and starts_at > now() order by starts_at limit 1),
  null, 'reset_event_to_series restores an unnamed series'' NULL title'
);

-- ---------------------------------------------------------------------------
-- Feeds.
-- ---------------------------------------------------------------------------
select is(
  (select title from public.my_games(now(), now() + interval '30 days')
    where event_id = (select id from ids where k = 'null_one')),
  null, 'my_games passes an unnamed game''s NULL title through'
);
select is(
  (select title from public.club_games('c1c1c1c1-0000-0000-0000-000000000001', now(), now() + interval '30 days')
    where event_id = (select id from ids where k = 'null_one')),
  null, 'club_games passes NULL through too'
);

-- A game thread for the unnamed open game; H organizes, so can read it.
reset role;
insert into public.message_threads (club_id, event_id, last_message_at)
values ('c1c1c1c1-0000-0000-0000-000000000001', (select id from ids where k = 'null_one'), now());
set local role authenticated;
set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-0000-0000-000000000002", "role": "authenticated"}';

select is(
  (select title from public.fetch_my_threads() where event_id = (select id from ids where k = 'null_one')),
  'Open play', 'fetch_my_threads names an unnamed game''s thread "Open play"'
);

-- M holds an invite to an unnamed invite-only game.
reset role;
update public.events set title = null where id = (select id from ids where k = 'blank_one');
insert into public.booking_groups (id, event_id, club_id, created_by, status) values
  ('99000000-0000-0000-0000-000000000001', (select id from ids where k = 'blank_one'),
   'c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'confirmed');
insert into public.bookings
  (group_id, event_id, club_id, profile_id, booked_by, status, invite_holds_seat)
values
  ('99000000-0000-0000-0000-000000000001', (select id from ids where k = 'blank_one'),
   'c1c1c1c1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000002', 'invited', true);

-- Outbox rows for M: unnamed open, unnamed invite-only, named, and a
-- shortened-series row whose event is gone (event_id null).
insert into public.notification_outbox (id, recipient_id, club_id, event_id, kind, payload, dedupe_key) values
  ('0b000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', (select id from ids where k = 'null_one'),
   'booked_by_friend', '{}'::jsonb, 'ogn:1'),
  ('0b000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', (select id from ids where k = 'blank_one'),
   'booking_invited', '{}'::jsonb, 'ogn:2'),
  ('0b000000-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001',
   (select id from public.events where series_id = (select id from ids where k = 'null_series')
       and starts_at > now() order by starts_at limit 1),
   'event_reminder', '{}'::jsonb, 'ogn:3'),
  ('0b000000-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001',
   'c1c1c1c1-0000-0000-0000-000000000001', null,
   'event_cancelled', '{}'::jsonb, 'ogn:4');

select is(
  (select event_title from public.outbox_render_context(array['0b000000-0000-0000-0000-000000000001'::uuid])),
  'Open play', 'outbox_render_context: an unnamed open game renders as "Open play"'
);
select is(
  (select event_title from public.outbox_render_context(array['0b000000-0000-0000-0000-000000000002'::uuid])),
  'Private game', 'outbox_render_context: an unnamed invite-only game renders as "Private game"'
);
select is(
  (select event_title from public.outbox_render_context(array['0b000000-0000-0000-0000-000000000003'::uuid])),
  'Named later', 'outbox_render_context: a named game keeps its name'
);
select is(
  (select event_title from public.outbox_render_context(array['0b000000-0000-0000-0000-000000000004'::uuid])),
  null, 'outbox_render_context: no event, no title (templates say "the game")'
);

-- N is invited to C1 by email: once to the unnamed open game, once to no game.
insert into public.club_invites (club_id, email, event_id, invited_by) values
  ('c1c1c1c1-0000-0000-0000-000000000001', 'newbie@example.com',
   (select id from ids where k = 'null_one'), 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'newbie@example.com',
   null, 'bbbbbbbb-0000-0000-0000-000000000002');

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-0000-0000-000000000001", "role": "authenticated"}';

select is(
  (select event_title from public.my_upcoming_bookings()
    where event_id = (select id from ids where k = 'blank_one')),
  'Private game', 'my_upcoming_bookings: an unnamed invite-only game is "Private game"'
);
select is(
  (select event_title from public.fetch_my_notifications()
    where id = '0b000000-0000-0000-0000-000000000001'),
  'Open play', 'fetch_my_notifications (Alerts) carries the fallback too'
);

set local request.jwt.claims = '{"sub": "eeeeeeee-0000-0000-0000-000000000005", "role": "authenticated"}';
select is(
  (select event_title from public.fetch_my_pending_invites() where event_id is not null),
  'Open play', 'fetch_my_pending_invites: an invite to an unnamed game says "Open play"'
);
select is(
  (select event_title from public.fetch_my_pending_invites() where event_id is null),
  null, 'fetch_my_pending_invites: an invite with no game still has no title'
);

select * from finish();
rollback;
