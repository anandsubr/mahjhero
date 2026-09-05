begin;
set local search_path to extensions, public;
select plan(7);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ee01', 'em-host@example.com');

insert into public.clubs (id, name, slug, default_game_mode, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ee01', 'Mutation Club', 'mutation-club',
   'invite_only', 'aaaaaaaa-0000-0000-0000-00000000ee01');

insert into public.club_members (club_id, profile_id, role) values
  ('c1c1c1c1-0000-0000-0000-00000000ee01',
   'aaaaaaaa-0000-0000-0000-00000000ee01', 'host');

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000ee01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000ee01',
   'aaaaaaaa-0000-0000-0000-00000000ee01');

set local role authenticated;
set local request.jwt.claims =
  '{"sub": "aaaaaaaa-0000-0000-0000-00000000ee01", "role": "authenticated"}';

-- create_event with no explicit game_mode inherits the club default.
create temporary table created_event on commit drop as
  select public.create_event(
    'c1c1c1c1-0000-0000-0000-00000000ee01', 'Inherited Game',
    '11111111-0000-0000-0000-00000000ee01', '', current_date + 1, '19:00'
  ) as id;

select is(
  (select game_mode::text from public.events
   where id = (select id from created_event)),
  'invite_only',
  'create_event with no explicit game_mode inherits the club default'
);

-- create_event with an explicit override wins over the club default.
create temporary table created_event2 on commit drop as
  select public.create_event(
    'c1c1c1c1-0000-0000-0000-00000000ee01', 'Overridden Game',
    '11111111-0000-0000-0000-00000000ee01', '', current_date + 1, '20:00',
    180, 1, false, 0, 0, 'open_play'
  ) as id;

select is(
  (select game_mode::text from public.events
   where id = (select id from created_event2)),
  'open_play',
  'create_event honours an explicit game_mode override'
);

-- update_event leaves game_mode alone when not passed.
select public.update_event((select id from created_event2), new_title => 'Renamed');

select is(
  (select game_mode::text from public.events
   where id = (select id from created_event2)),
  'open_play',
  'update_event leaves game_mode alone when not passed'
);

-- update_event changes game_mode when passed.
select public.update_event(
  (select id from created_event2), new_game_mode => 'invite_only');

select is(
  (select game_mode::text from public.events
   where id = (select id from created_event2)),
  'invite_only',
  'update_event changes game_mode when passed'
);

-- create_event_series / materialization / update_event_series push-down.
create temporary table created_series on commit drop as
  select public.create_event_series(
    'c1c1c1c1-0000-0000-0000-00000000ee01', 'Weekly Series',
    '11111111-0000-0000-0000-00000000ee01', '', 'weekly'::public.series_frequency, 2::smallint, null::smallint, '19:00'::time,
    180, 1, current_date, null::date, false, 0, 0, 'open_play'::public.game_mode
  ) as id;

select is(
  (select game_mode::text from public.event_series
   where id = (select id from created_series)),
  'open_play',
  'create_event_series honours an explicit game_mode override'
);

select is(
  (select game_mode::text from public.events
   where series_id = (select id from created_series)
   order by occurrence_date limit 1),
  'open_play',
  'the first materialized occurrence inherits the series game_mode'
);

select public.update_event_series(
  (select id from created_series), new_game_mode => 'invite_only');

select is(
  (select count(*)::int from public.events
   where series_id = (select id from created_series)
     and status <> 'cancelled'
     and starts_at > now()
     and game_mode <> 'invite_only'),
  0,
  'update_event_series pushes game_mode onto every future, uncustomised occurrence'
);

select * from finish();
rollback;
