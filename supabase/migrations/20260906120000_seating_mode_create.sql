/*
 * Threads Task 1's seating_mode/capacity through event creation, and relaxes
 * remove_event_table's "keep at least one table" floor for open seating.
 *
 * create_event / create_event_series get two new trailing, defaulted
 * arguments -- event_seating_mode/series_seating_mode and capacity_limit --
 * following the same drop-and-recreate dance as
 * 20260905110000_event_game_mode_mutations.sql. Bodies are copied verbatim
 * from that file and changed only where this comment says so.
 *
 * The new parameter is named capacity_limit, not capacity: a parameter
 * named capacity would shadow the event_tables.capacity column referenced
 * in create_event's table-insert.
 */

-- ---------------------------------------------------------------------------
-- create_event
-- ---------------------------------------------------------------------------
drop function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int,
  public.game_mode);

create function public.create_event(
  target_club      uuid,
  event_title      text,
  target_venue     uuid,
  event_notes      text default '',
  event_date       date default null,
  start_time       time default null,
  duration_minutes int default 180,
  table_count      int default 1,
  check_in         boolean default false,
  fee_cents        int default 0,
  min_spend_cents  int default 0,
  event_game_mode  public.game_mode default null,
  event_seating_mode public.seating_mode default 'assigned_tables',
  capacity_limit     int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id  uuid;
  club_tz text;
  starts  timestamptz;
  eff_mode public.game_mode;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(event_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if event_date is null or start_time is null then
    raise exception 'an event must have a date and a start time'
      using errcode = '23514';
  end if;
  -- The same window event_series.duration_minutes is constrained to
  -- (20260822194000), so a one-off and a series cannot disagree about what
  -- a plausible game length is.
  if duration_minutes is null or duration_minutes not between 15 and 1440 then
    raise exception 'duration out of range' using errcode = '23514';
  end if;
  if event_seating_mode = 'open_seating' then
    if table_count < 0 or table_count > 20 then
      raise exception 'table count out of range' using errcode = '23514';
    end if;
  else
    if table_count < 1 or table_count > 20 then
      raise exception 'table count out of range' using errcode = '23514';
    end if;
  end if;

  if capacity_limit is not null and capacity_limit < 1 then
    raise exception 'capacity must be at least one' using errcode = '23514';
  end if;
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  -- assert_club_organizer already established that this club exists and that
  -- the caller organizes it, so this cannot come back null.
  select c.timezone, coalesce(event_game_mode, c.default_game_mode)
    into club_tz, eff_mode
    from public.clubs c where c.id = target_club;

  -- The one conversion. Character-for-character the expression
  -- materialize_one_series uses (20260823000000), because a one-off game at
  -- 7pm and the first week of a series at 7pm must land on the same instant.
  starts := (event_date + start_time) at time zone club_tz;

  -- The new check. After the conversion, because the club's timezone is what
  -- decides whether the host's digits are in the past.
  if starts < now() then
    raise exception 'that start time has already passed' using errcode = '23514';
  end if;

  insert into public.events (
    club_id, title, venue_id, notes, starts_at, ends_at,
    check_in_required, fee_cents, min_spend_cents, game_mode,
    seating_mode, capacity, created_by
  ) values (
    target_club, trim(event_title), target_venue, coalesce(event_notes, ''),
    starts, starts + make_interval(mins => duration_minutes),
    coalesce(check_in, false), fee_cents, min_spend_cents, eff_mode,
    event_seating_mode, capacity_limit, auth.uid()
  )
  returning id into new_id;

  -- generate_series(1, 0) yields no rows, so an open-seating event created
  -- with table_count => 0 falls out of this insert with zero event_tables
  -- rows naturally -- no branch needed here.
  insert into public.event_tables (event_id, club_id, label, position)
  select new_id, target_club, 'Table ' || g, g
  from generate_series(1, table_count) g;

  return new_id;
end;
$$;

revoke execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- create_event_series
-- ---------------------------------------------------------------------------
drop function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int, public.game_mode);

create function public.create_event_series(
  target_club     uuid,
  series_title    text,
  target_venue    uuid,
  series_notes    text default '',
  freq            public.series_frequency default 'weekly',
  weekday         smallint default 2,
  nth_week        smallint default null,
  start_time      time default '19:00',
  duration_minutes int default 180,
  table_count     int default 1,
  starts_on       date default null,
  ends_on         date default null,
  check_in        boolean default false,
  fee_cents       int default 0,
  min_spend_cents int default 0,
  series_game_mode public.game_mode default null,
  series_seating_mode public.seating_mode default 'assigned_tables',
  capacity_limit      int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id     uuid;
  first_date date;
  eff_mode   public.game_mode;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(series_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  select coalesce(series_game_mode, default_game_mode) into eff_mode
    from public.clubs where id = target_club;

  insert into public.event_series (
    club_id, title, venue_id, notes, frequency, weekday, nth_week,
    start_time, duration_minutes, table_count, starts_on, ends_on,
    check_in_required, fee_cents, min_spend_cents, game_mode,
    seating_mode, capacity, created_by
  ) values (
    target_club, trim(series_title), target_venue, coalesce(series_notes, ''),
    freq, weekday, nth_week, start_time, duration_minutes, table_count,
    coalesce(starts_on, current_date), ends_on, coalesce(check_in, false),
    fee_cents, min_spend_cents, eff_mode,
    series_seating_mode, capacity_limit, auth.uid()
  )
  returning id into new_id;

  /*
   * The new check: a capped run that produces no game at all.
   *
   * A series with `ends_on` already behind us materializes nothing, ever, and
   * used to report success -- the same invisible-save this file exists to
   * close, one level up. So does a run capped before its own first
   * occurrence: "every 5th Tuesday, stopping in three weeks" is a rule and an
   * end date that never meet.
   *
   * Asked of series_occurrence_dates rather than reimplemented, so this
   * cannot drift from what materialization will actually generate, and asked
   * over the WHOLE remaining run ([today-or-later .. ends_on], the same floor
   * materialize_one_series applies) rather than the 42-day horizon -- a
   * monthly rule can legitimately produce nothing for six weeks and still be
   * a perfectly good series.
   *
   * Only when `ends_on` is set. An open-ended series always produces
   * something eventually, whatever the rule.
   *
   * Placed AFTER the insert on purpose: event_series' own constraints
   * (nth_week matching the frequency, ends_on >= starts_on) have already been
   * enforced by then, so a monthly series sent with a null nth_week gets the
   * constraint error that names its real problem instead of this one, which
   * would be true but misleading. The exception rolls the insert back with
   * it.
   */
  if ends_on is not null then
    select d into first_date
    from public.series_occurrence_dates(
      freq, weekday, nth_week,
      coalesce(starts_on, current_date), ends_on,
      greatest(coalesce(starts_on, current_date), current_date), ends_on
    ) d
    limit 1;

    if first_date is null then
      raise exception 'no games before that end date' using errcode = '23514';
    end if;
  end if;

  -- Synchronously, in the same transaction, and for THIS series only. A host
  -- who creates a series and sees no games has watched the feature fail,
  -- whatever happens at 3am -- and materialize_one_series lets the error
  -- propagate, so a failure rolls the creation back with it rather than
  -- leaving an empty series behind a success message. The sweep is for cron:
  -- calling it here would make one host's request materialize every club's
  -- series, and would swallow the failure of the very series being created.
  perform public.materialize_one_series(new_id);

  return new_id;
end;
$$;

revoke execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  from public, anon;
grant execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int,
  public.game_mode, public.seating_mode, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- remove_event_table
--
-- The "an event must keep at least one table" floor exists to protect
-- assigned_tables capacity, which is derived by summing event_tables. An
-- open-seating event's capacity comes from events.capacity instead (see
-- 20260906110000_capacity_resolution.sql), so that floor has nothing to
-- protect there -- an open-seating organizer must be able to remove every
-- table. Signature is unchanged, so this is create-or-replace, not
-- drop-and-recreate. Body copied verbatim from
-- 20260825040000_event_disruption.sql, changed only where noted below.
-- ---------------------------------------------------------------------------
create or replace function public.remove_event_table(target_table uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club  uuid;
  owning_event uuid;
  event_status public.event_status;
  ev_seating   public.seating_mode;
  remaining    int;
begin
  select t.club_id, t.event_id, e.status, e.seating_mode
  into owning_club, owning_event, event_status, ev_seating
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  if event_status = 'cancelled' then
    raise exception 'a cancelled event''s tables cannot be edited'
      using errcode = '42501';
  end if;

  perform 1 from public.events where id = owning_event for update;

  with locked as (
    select id from public.event_tables
    where event_id = owning_event
    for update
  )
  select count(*) into remaining from locked;

  -- An open-seating event's capacity does not come from tables, so there is
  -- no floor to protect: removing the last one is legitimate. The unseat-
  -- never-destroy rule below still applies either way.
  if ev_seating = 'assigned_tables' and remaining <= 1 then
    raise exception 'an event must keep at least one table'
      using errcode = '23514';
  end if;

  -- Unseat before deleting. These people are still coming; they just have
  -- nowhere to sit until the host places them.
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id, b.club_id, b.event_id, 'unseated',
         jsonb_build_object('booking_id', b.id,
                            'event_table_id', target_table),
         'unseated:' || b.id::text || ':' || target_table::text
  from public.bookings b
  where b.event_table_id = target_table and b.status = 'confirmed'
  on conflict (dedupe_key) do nothing;

  update public.bookings
     set event_table_id = null
   where event_table_id = target_table;

  -- Explicit, not load-bearing: 20260825041000 scopes booking_groups' composite
  -- FK to event_tables so its ON DELETE SET NULL only ever touches
  -- preferred_table_id, never event_id, so the DELETE below would leave
  -- this column correctly nulled on its own. Kept anyway so the effect is
  -- visible right here, before promote_waitlist reads booking_groups a few
  -- lines down, rather than asking a reader to know which ON DELETE action
  -- a constraint two migrations away performs.
  update public.booking_groups
     set preferred_table_id = null
   where preferred_table_id = target_table;

  delete from public.event_tables where id = target_table;

  -- Capacity just dropped; nobody new can be promoted into it. The call
  -- is here anyway because a group that wanted THIS table may now fit
  -- somewhere else, and because leaving it out would make "every path
  -- that changes capacity promotes" a rule with an exception.
  perform public.promote_waitlist(owning_event);

  return true;
end;
$$;

revoke execute on function public.remove_event_table(uuid) from public, anon;
grant  execute on function public.remove_event_table(uuid) to authenticated;
