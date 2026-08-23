/*
 * A game the host cannot see must not save with a success message.
 *
 * `fetchUpcomingEvents` filters `starts_at >= now()` and is the ONLY events
 * listing in the app -- the spec deliberately builds no all-events route. So
 * today `create_event(..., event_date => '2020-01-01')` returns a uuid, the
 * row is really there, the screen shows a success redirect, and the game is
 * visible nowhere at all. A mistyped year is enough to do it. `update_event`
 * with a past `new_date` does the same to a game that was fine a moment ago,
 * and a series whose whole run is already over saves with zero occurrences
 * materialized and no complaint.
 *
 * ---------------------------------------------------------------------------
 * Why the guard is in the database and not only on the screens
 * ---------------------------------------------------------------------------
 *
 * The screens do get their half -- `minimumDate` / `min` on every DateField
 * (components/DateField.tsx and .web.tsx), which is the cheapest and the most
 * helpful place to say "not that day". But it cannot be the only place:
 *
 *   - `min` on `<input type="date">` is advisory. It marks the field
 *     `:invalid`; it does not stop a submit, and it does not exist at all for
 *     a value typed into the text portion of the control in some browsers.
 *   - A date picker constrains the DATE. It cannot constrain the INSTANT, and
 *     the instant is what the listing filters on: 7pm today, entered at 9pm
 *     today, is a perfectly ordinary date and an invisible game.
 *   - The device's clock and calendar are the host's, not the club's. Only
 *     Postgres knows `now()` against the club's timezone.
 *
 * So the client guard is the courtesy and this one is the guarantee. Both are
 * needed, and neither is redundant.
 *
 * The comparison is against the INSTANT (`starts < now()`), not against the
 * calendar date. A date-only check would still let a game that started two
 * hours ago save into a listing that will never show it, which is the exact
 * failure being fixed, only smaller. The cost is that a host cannot enter a
 * game that has already begun -- correct, because they could not see it
 * afterwards either.
 *
 * The message text is load-bearing. lib/events.ts's `rpcErrorMessage` matches
 * SQLSTATE 23514 plus this substring to tell the host what actually happened
 * instead of claiming their internet is down; lib/schema-contract.test.ts
 * pins the pairing against a real database, so rewording this string without
 * rewording that mapper turns the contract suite red.
 *
 * `create or replace` throughout: every parameter list is byte-identical to
 * the definition being replaced, so no function is re-signatured, no ACL is
 * dropped, and nothing needs re-granting (restated at the bottom regardless,
 * per this branch's standing rule). Every other guard, lock, comment and
 * expression carries across unchanged from 20260823070000 (create_event,
 * update_event) and 20260823030000 (create_event_series); the diff against
 * each is exactly the new check.
 *
 * Deliberately NOT guarded: `update_event_series`'s `new_ends_on`. Pulling a
 * run's end back to a date in the past is a legitimate act -- it means "this
 * series is over" -- it creates nothing invisible, and past occurrences
 * remain in place as history either way (20260824000000 only removes FUTURE
 * weeks). The edit screen's own DateField still refuses to offer a past date,
 * which is where that mistake would actually be made.
 */

-- ---------------------------------------------------------------------------
-- create_event
-- ---------------------------------------------------------------------------
create or replace function public.create_event(
  target_club      uuid,
  event_title      text,
  target_venue     uuid,
  event_notes      text default '',
  event_date       date default null,
  start_time       time default null,
  duration_minutes int default 180,
  table_count      int default 1
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
  if table_count < 1 or table_count > 20 then
    raise exception 'table count out of range' using errcode = '23514';
  end if;

  -- assert_club_organizer already established that this club exists and that
  -- the caller organizes it, so this cannot come back null.
  select c.timezone into club_tz from public.clubs c where c.id = target_club;

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
    club_id, title, venue_id, notes, starts_at, ends_at, created_by
  ) values (
    target_club, trim(event_title), target_venue, coalesce(event_notes, ''),
    starts, starts + make_interval(mins => duration_minutes), auth.uid()
  )
  returning id into new_id;

  insert into public.event_tables (event_id, club_id, label, position)
  select new_id, target_club, 'Table ' || g, g
  from generate_series(1, table_count) g;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- update_event
-- ---------------------------------------------------------------------------
create or replace function public.update_event(
  target_event         uuid,
  new_title            text default null,
  new_venue_id         uuid default null,
  new_notes            text default null,
  new_date             date default null,
  new_start_time       time default null,
  new_duration_minutes int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ev             public.events;
  club_tz        text;
  local_start    timestamp;
  eff_title      text;
  eff_venue      uuid;
  eff_notes      text;
  eff_date       date;
  eff_time       time;
  eff_duration   int;
  eff_starts     timestamptz;
  eff_ends       timestamptz;
  next_overrides text[];
begin
  select * into ev from public.events where id = target_event for update;

  if ev.id is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(ev.club_id);
  if ev.status = 'cancelled' then
    raise exception 'a cancelled event cannot be edited'
      using errcode = '42501';
  end if;

  eff_title := coalesce(new_title, ev.title);
  eff_venue := coalesce(new_venue_id, ev.venue_id);
  eff_notes := coalesce(new_notes, ev.notes);

  if new_date is null and new_start_time is null
     and new_duration_minutes is null then
    eff_starts := ev.starts_at;
    eff_ends   := ev.ends_at;
  else
    if new_duration_minutes is not null
       and new_duration_minutes not between 15 and 1440 then
      raise exception 'duration out of range' using errcode = '23514';
    end if;

    select c.timezone into club_tz from public.clubs c where c.id = ev.club_id;

    -- What the host currently sees on the club's wall clock. Whichever of
    -- the three calendar values this edit did not name is taken from here,
    -- so "move this week to Thursday" keeps 7pm rather than keeping an
    -- instant that reads as 6pm on the other side of a DST transition.
    local_start := ev.starts_at at time zone club_tz;

    eff_date := coalesce(new_date, local_start::date);
    eff_time := coalesce(new_start_time, local_start::time);
    -- Elapsed minutes, not wall-clock difference: a game that ran across a
    -- transition is three hours long in both readings, and the interval
    -- between the two stored instants is the one that is true.
    eff_duration := coalesce(
      new_duration_minutes,
      (extract(epoch from (ev.ends_at - ev.starts_at)) / 60)::int);

    eff_starts := (eff_date + eff_time) at time zone club_tz;
    eff_ends   := eff_starts + make_interval(mins => eff_duration);
  end if;

  if eff_venue is distinct from ev.venue_id then
    perform public.assert_venue_available(ev.club_id, eff_venue);
  end if;

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if eff_ends <= eff_starts then
    raise exception 'an event must end after it starts' using errcode = '23514';
  end if;

  -- The new check, and note what it is conditioned on. It refuses to MOVE a
  -- game into the past; it does not refuse to edit a game that is already
  -- there. A host correcting the name or the notes on last Tuesday's game is
  -- editing history, which this function has always allowed and which
  -- rejecting `eff_starts < now()` outright would break -- an event's own
  -- stored instant is the one thing it is guaranteed to have.
  --
  -- One acknowledged edge: for an already-past event inside a DST fall-back's
  -- repeated local hour, a duration-only edit round-trips its wall clock to
  -- the OTHER of the two instants, which is `distinct from` the stored one
  -- and in the past, so it is refused. That is the same instant-moving edit
  -- the check exists to stop, arriving by an unlucky door; the alternative
  -- (dropping the `distinct from` half) would refuse every edit to every past
  -- game, which is far worse.
  if eff_starts is distinct from ev.starts_at and eff_starts < now() then
    raise exception 'that start time has already passed' using errcode = '23514';
  end if;

  next_overrides := ev.overrides;

  if ev.series_id is not null then
    -- array_append, not `||` with a text literal on the right: that resolves
    -- to the anyarray-concatenation overload and fails with "malformed array
    -- literal" (22P02). See 20260823020000.
    if trim(eff_title) is distinct from trim(ev.title) then
      next_overrides := array_append(next_overrides, 'title');
    end if;
    if eff_venue is distinct from ev.venue_id then
      next_overrides := array_append(next_overrides, 'venue_id');
    end if;
    if eff_notes is distinct from ev.notes then
      next_overrides := array_append(next_overrides, 'notes');
    end if;
    if eff_starts is distinct from ev.starts_at
       or eff_ends is distinct from ev.ends_at then
      next_overrides := array_append(next_overrides, 'starts_at');
    end if;

    select coalesce(array_agg(distinct k order by k), '{}')
      into next_overrides
      from unnest(next_overrides) k;
  end if;

  update public.events set
    title     = trim(eff_title),
    venue_id  = eff_venue,
    notes     = eff_notes,
    starts_at = eff_starts,
    ends_at   = eff_ends,
    overrides = next_overrides
  where id = target_event;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_event_series
-- ---------------------------------------------------------------------------
create or replace function public.create_event_series(
  target_club   uuid,
  series_title  text,
  target_venue  uuid,
  series_notes  text default '',
  freq          public.series_frequency default 'weekly',
  weekday       smallint default 2,
  nth_week      smallint default null,
  start_time    time default '19:00',
  duration_minutes int default 180,
  table_count   int default 1,
  starts_on     date default null,
  ends_on       date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id     uuid;
  first_date date;
begin
  perform public.assert_club_organizer(target_club);
  perform public.assert_venue_available(target_club, target_venue);

  if length(trim(coalesce(series_title, ''))) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;

  insert into public.event_series (
    club_id, title, venue_id, notes, frequency, weekday, nth_week,
    start_time, duration_minutes, table_count, starts_on, ends_on, created_by
  ) values (
    target_club, trim(series_title), target_venue, coalesce(series_notes, ''),
    freq, weekday, nth_week, start_time, duration_minutes, table_count,
    coalesce(starts_on, current_date), ends_on, auth.uid()
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

-- ---------------------------------------------------------------------------
-- The ACLs, restated.
--
-- `create or replace` preserves them -- every signature above is unchanged --
-- so these are no-ops today. They are written out anyway because this branch
-- has now been bitten four times (20260822045809, 20260823000000,
-- 20260823070000, 20260823080000) by assuming an ACL survived a definition
-- change, and because supabase/tests/database/portable/grants.test.sql checks
-- them against hosted rather than inferring them from a local reset.
-- ---------------------------------------------------------------------------
revoke execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int) from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int) to authenticated;

revoke execute on function public.update_event(
  uuid, text, uuid, text, date, time, int) from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, date, time, int) to authenticated;

revoke execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date) from public, anon;
grant execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date) to authenticated;
