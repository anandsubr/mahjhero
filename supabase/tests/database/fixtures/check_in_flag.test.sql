begin;
set local search_path to extensions, public;

select plan(6);

-- Fixture: one user, one club, one venue, one series.
insert into auth.users (id, email)
  values ('11111111-1111-1111-1111-111111111111', 'host@example.com');
update public.profiles set display_name = 'Host'
  where id = '11111111-1111-1111-1111-111111111111';

insert into public.clubs (id, name, slug, timezone, created_by)
  values ('22222222-2222-2222-2222-222222222222', 'Test Club', 'test-club',
          'America/New_York', '11111111-1111-1111-1111-111111111111');

insert into public.club_members (club_id, profile_id, role, status)
  values ('22222222-2222-2222-2222-222222222222',
          '11111111-1111-1111-1111-111111111111', 'host', 'active')
  on conflict do nothing;
insert into public.venues (id, added_by_club_id, name, created_by)
  values ('33333333-3333-3333-3333-333333333333',
          '22222222-2222-2222-2222-222222222222', 'The Hall',
          '11111111-1111-1111-1111-111111111111');

-- 1 & 2: the columns exist and default to false.
select has_column('public', 'events', 'check_in_required',
  'events.check_in_required exists');

insert into public.event_series (
  id, club_id, title, venue_id, frequency, weekday, start_time,
  starts_on, check_in_required, created_by)
values ('44444444-4444-4444-4444-444444444444',
        '22222222-2222-2222-2222-222222222222', 'Tuesday Night',
        '33333333-3333-3333-3333-333333333333', 'weekly', 2, '19:00',
        current_date, true, '11111111-1111-1111-1111-111111111111');

select is(
  (select check_in_required from public.event_series
     where id = '44444444-4444-4444-4444-444444444444'),
  true,
  'event_series.check_in_required stores what it was given');

-- 3: materialization carries the flag onto every occurrence.
select ok(
  public.materialize_one_series(
    '44444444-4444-4444-4444-444444444444', 21) > 0,
  'the series materialized at least one occurrence');

select is(
  (select bool_and(check_in_required) from public.events
     where series_id = '44444444-4444-4444-4444-444444444444'),
  true,
  'every materialized occurrence inherits check_in_required');

-- 4: a one-off event defaults to false.
insert into public.events (club_id, title, venue_id, starts_at, ends_at,
                           created_by)
values ('22222222-2222-2222-2222-222222222222', 'One-off',
        '33333333-3333-3333-3333-333333333333',
        now() + interval '2 days', now() + interval '2 days 3 hours',
        '11111111-1111-1111-1111-111111111111');

select is(
  (select check_in_required from public.events where title = 'One-off'),
  false,
  'a one-off event defaults to check-in not required');

-- 5: the overrides constraint accepts the new key.
select lives_ok(
  $$update public.events
      set overrides = array['check_in_required']
      where title = 'One-off'$$,
  'check_in_required is a legal overrides key');

select * from finish();
rollback;
