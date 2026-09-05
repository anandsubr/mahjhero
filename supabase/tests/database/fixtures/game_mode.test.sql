begin;
set local search_path to extensions, public;
select plan(9);

select has_column('public', 'clubs', 'default_game_mode', 'clubs has default_game_mode');
select has_column('public', 'event_series', 'game_mode', 'event_series has game_mode');
select has_column('public', 'events', 'game_mode', 'events has game_mode');

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-00000000ab01', 'gm-host@example.com');

insert into public.clubs (id, name, slug, created_by) values
  ('c1c1c1c1-0000-0000-0000-00000000ab01', 'Game Mode Club', 'game-mode-club',
   'aaaaaaaa-0000-0000-0000-00000000ab01');

select is(
  (select default_game_mode::text from public.clubs
   where id = 'c1c1c1c1-0000-0000-0000-00000000ab01'),
  'open_play',
  'a club defaults to open_play'
);

insert into public.venues (id, name, added_by_club_id, created_by) values
  ('11111111-0000-0000-0000-00000000ab01', 'Test Hall',
   'c1c1c1c1-0000-0000-0000-00000000ab01', 'aaaaaaaa-0000-0000-0000-00000000ab01');

insert into public.events (
  id, club_id, title, venue_id, starts_at, ends_at, created_by
) values (
  '22222222-0000-0000-0000-00000000ab01', 'c1c1c1c1-0000-0000-0000-00000000ab01',
  'Test Game', '11111111-0000-0000-0000-00000000ab01',
  now() + interval '1 day', now() + interval '1 day 3 hours',
  'aaaaaaaa-0000-0000-0000-00000000ab01'
);

select is(
  (select game_mode::text from public.events
   where id = '22222222-0000-0000-0000-00000000ab01'),
  'open_play',
  'an event defaults to open_play'
);

select throws_ok(
  $$update public.events set overrides = array['bogus_key']
    where id = '22222222-0000-0000-0000-00000000ab01'$$,
  '23514',
  null,
  'overrides still rejects an unknown key'
);

select lives_ok(
  $$update public.events set overrides = array['game_mode']
    where id = '22222222-0000-0000-0000-00000000ab01'$$,
  'overrides now accepts game_mode as a known key'
);

insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  duration_minutes, table_count, starts_on, game_mode, created_by
) values (
  '33333333-0000-0000-0000-00000000ab01', 'c1c1c1c1-0000-0000-0000-00000000ab01',
  'Weekly Test', '11111111-0000-0000-0000-00000000ab01', 'weekly', 2, '19:00',
  180, 4, current_date, 'invite_only', 'aaaaaaaa-0000-0000-0000-00000000ab01'
);

select is(
  public.materialize_one_series('33333333-0000-0000-0000-00000000ab01'),
  6,
  'materialize_one_series creates weekly event occurrences'
);

select is(
  (select game_mode::text from public.events
   where series_id = '33333333-0000-0000-0000-00000000ab01'
   order by occurrence_date limit 1),
  'invite_only',
  'materialize_one_series carries the series game_mode onto each occurrence'
);

select * from finish();
rollback;
