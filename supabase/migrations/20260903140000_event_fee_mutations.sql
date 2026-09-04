/*
 * Same drop-and-recreate dance as 20260827010000_event_mutations_check_in.sql
 * (whose own header comment explains why `create or replace` cannot add a
 * parameter): two new trailing, defaulted arguments on each of these four,
 * bodies copied byte-for-byte from that migration (each function's own most
 * recent redefinition), with fee_cents/min_spend_cents threaded through
 * exactly where check_in/check_in_required already are.
 */

-- ---------------------------------------------------------------------------
-- create_event
-- ---------------------------------------------------------------------------
drop function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean);

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
  min_spend_cents  int default 0
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
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
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
    club_id, title, venue_id, notes, starts_at, ends_at,
    check_in_required, fee_cents, min_spend_cents, created_by
  ) values (
    target_club, trim(event_title), target_venue, coalesce(event_notes, ''),
    starts, starts + make_interval(mins => duration_minutes),
    coalesce(check_in, false), fee_cents, min_spend_cents, auth.uid()
  )
  returning id into new_id;

  insert into public.event_tables (event_id, club_id, label, position)
  select new_id, target_club, 'Table ' || g, g
  from generate_series(1, table_count) g;

  return new_id;
end;
$$;

revoke execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int)
  from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int, boolean, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event
-- ---------------------------------------------------------------------------
drop function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean);

create function public.update_event(
  target_event         uuid,
  new_title            text default null,
  new_venue_id         uuid default null,
  new_notes            text default null,
  new_date             date default null,
  new_start_time       time default null,
  new_duration_minutes int default null,
  new_check_in_required boolean default null,
  new_fee_cents        int default null,
  new_min_spend_cents  int default null
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
  eff_check_in   boolean;
  eff_fee        int;
  eff_min_spend  int;
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
  eff_check_in := coalesce(new_check_in_required, ev.check_in_required);
  eff_fee := coalesce(new_fee_cents, ev.fee_cents);
  eff_min_spend := coalesce(new_min_spend_cents, ev.min_spend_cents);

  if eff_fee < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if eff_min_spend < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

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
    if new_check_in_required is not null
       and new_check_in_required is distinct from ev.check_in_required then
      next_overrides := array_append(next_overrides, 'check_in_required');
    end if;
    if new_fee_cents is not null
       and new_fee_cents is distinct from ev.fee_cents then
      next_overrides := array_append(next_overrides, 'fee_cents');
    end if;
    if new_min_spend_cents is not null
       and new_min_spend_cents is distinct from ev.min_spend_cents then
      next_overrides := array_append(next_overrides, 'min_spend_cents');
    end if;

    select coalesce(array_agg(distinct k order by k), '{}')
      into next_overrides
      from unnest(next_overrides) k;
  end if;

  update public.events set
    title              = trim(eff_title),
    venue_id           = eff_venue,
    notes              = eff_notes,
    starts_at          = eff_starts,
    ends_at            = eff_ends,
    check_in_required  = eff_check_in,
    fee_cents          = eff_fee,
    min_spend_cents    = eff_min_spend,
    overrides          = next_overrides
  where id = target_event;

  return true;
end;
$$;

revoke execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int)
  from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- create_event_series
-- ---------------------------------------------------------------------------
drop function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean);

create function public.create_event_series(
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
  ends_on       date default null,
  check_in      boolean default false,
  fee_cents     int default 0,
  min_spend_cents int default 0
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
  if fee_cents is null or fee_cents < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if min_spend_cents is null or min_spend_cents < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  insert into public.event_series (
    club_id, title, venue_id, notes, frequency, weekday, nth_week,
    start_time, duration_minutes, table_count, starts_on, ends_on,
    check_in_required, fee_cents, min_spend_cents, created_by
  ) values (
    target_club, trim(series_title), target_venue, coalesce(series_notes, ''),
    freq, weekday, nth_week, start_time, duration_minutes, table_count,
    coalesce(starts_on, current_date), ends_on, coalesce(check_in, false),
    fee_cents, min_spend_cents, auth.uid()
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
  int, int, date, date, boolean, int, int)
  from public, anon;
grant execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint, time,
  int, int, date, date, boolean, int, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event_series
-- ---------------------------------------------------------------------------
drop function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean);

create function public.update_event_series(
  target_series      uuid,
  new_title          text default null,
  new_venue_id       uuid default null,
  new_notes          text default null,
  new_start_time     time default null,
  new_duration       int default null,
  new_table_count    int default null,
  new_ends_on        date default null,
  include_overridden boolean default false,
  clear_ends_on      boolean default false,
  new_check_in_required boolean default null,
  new_fee_cents      int default null,
  new_min_spend_cents int default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  se            public.event_series;
  club_tz       text;
  eff_title     text;
  eff_venue     uuid;
  eff_notes     text;
  eff_start     time;
  eff_dur       int;
  eff_count     int;
  eff_ends      date;
  eff_check_in  boolean;
  eff_fee       int;
  eff_min_spend int;
  touched_title boolean;
  touched_venue boolean;
  touched_notes boolean;
  touched_time  boolean;
  touched_check_in boolean;
  touched_fee   boolean;
  touched_min_spend boolean;
begin
  select * into se from public.event_series where id = target_series for update;

  if se.id is null then
    raise exception 'no such series' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(se.club_id);

  select timezone into club_tz from public.clubs where id = se.club_id;

  eff_title := coalesce(new_title, se.title);
  eff_venue := coalesce(new_venue_id, se.venue_id);
  eff_notes := coalesce(new_notes, se.notes);
  eff_start := coalesce(new_start_time, se.start_time);
  eff_dur   := coalesce(new_duration, se.duration_minutes);
  eff_count := coalesce(new_table_count, se.table_count);
  eff_check_in := coalesce(new_check_in_required, se.check_in_required);
  eff_fee := coalesce(new_fee_cents, se.fee_cents);
  eff_min_spend := coalesce(new_min_spend_cents, se.min_spend_cents);
  -- `clear_ends_on` wins over `new_ends_on` outright -- there is no reading
  -- of "clear it AND set it to this date" that makes sense, so precedence,
  -- not an error, is the simplest correct answer.
  eff_ends  := case when clear_ends_on then null
                    else coalesce(new_ends_on, se.ends_on) end;

  if eff_fee < 0 then
    raise exception 'fee cannot be negative' using errcode = '23514';
  end if;
  if eff_min_spend < 0 then
    raise exception 'minimum spend cannot be negative' using errcode = '23514';
  end if;

  -- The gate. Compared against `se`, the pre-edit snapshot, and computed
  -- before the UPDATE below overwrites the stored row.
  touched_title := trim(eff_title) is distinct from trim(se.title);
  touched_venue := eff_venue is distinct from se.venue_id;
  touched_notes := eff_notes is distinct from se.notes;
  touched_time  := eff_start is distinct from se.start_time
                or eff_dur   is distinct from se.duration_minutes;
  touched_check_in := eff_check_in is distinct from se.check_in_required;
  touched_fee := eff_fee is distinct from se.fee_cents;
  touched_min_spend := eff_min_spend is distinct from se.min_spend_cents;

  if eff_venue is distinct from se.venue_id then
    perform public.assert_venue_available(se.club_id, eff_venue);
  end if;

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;

  update public.event_series set
    title            = trim(eff_title),
    venue_id         = eff_venue,
    notes            = eff_notes,
    start_time       = eff_start,
    duration_minutes = eff_dur,
    table_count      = eff_count,
    ends_on          = eff_ends,
    check_in_required = eff_check_in,
    fee_cents        = eff_fee,
    min_spend_cents  = eff_min_spend
  where id = target_series;

  if touched_title then
    update public.events e set title = trim(eff_title)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('title' = any(e.overrides)));
  end if;

  if touched_venue then
    update public.events e set venue_id = eff_venue
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('venue_id' = any(e.overrides)));
  end if;

  if touched_notes then
    update public.events e set notes = eff_notes
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('notes' = any(e.overrides)));
  end if;

  if touched_check_in then
    update public.events e set check_in_required = eff_check_in
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('check_in_required' = any(e.overrides)));
  end if;

  if touched_fee then
    update public.events e set fee_cents = eff_fee
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('fee_cents' = any(e.overrides)));
  end if;

  if touched_min_spend then
    update public.events e set min_spend_cents = eff_min_spend
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('min_spend_cents' = any(e.overrides)));
  end if;

  -- One guard for both instants: a hand-set 6:30-9:30 week must not keep its
  -- start and silently take the series' new length.
  if touched_time then
    update public.events e set
      starts_at = (e.occurrence_date + eff_start) at time zone club_tz,
      ends_at   = ((e.occurrence_date + eff_start) at time zone club_tz)
                    + make_interval(mins => eff_dur)
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('starts_at' = any(e.overrides)));
  end if;

  -- Clear only the keys this edit actually changed.
  if include_overridden then
    update public.events e set overrides = (
      select coalesce(array_agg(k), '{}')
      from unnest(e.overrides) k
      where not (
        (k = 'title'      and touched_title)
        or (k = 'venue_id' and touched_venue)
        or (k = 'notes'    and touched_notes)
        or (k = 'starts_at' and touched_time)
        or (k = 'check_in_required' and touched_check_in)
        or (k = 'fee_cents' and touched_fee)
        or (k = 'min_spend_cents' and touched_min_spend)
      )
    )
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;

  -- Shortening the run REMOVES what now falls outside it -- see
  -- 20260824000000's file-level comment for why deleting, not cancelling,
  -- is the correct verb and what it buys. `eff_ends is not null` is what
  -- keeps this branch from firing when the run is instead being UNCAPPED
  -- (clear_ends_on, or a plain widening new_ends_on): there is nothing
  -- outside a boundary at infinity. A widening new_ends_on does enter this
  -- branch and matches no rows, which is correct and costs one indexed
  -- delete (plus, now, one indexed select that also matches no rows).
  if eff_ends is not null and eff_ends is distinct from se.ends_on then
    -- Told, not just dropped. See the file-level comment above for the
    -- event_id-cascade trap this INSERT has to run ahead of the DELETE to
    -- avoid, and why it is one row per member rather than per booking.
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    select distinct on (b.profile_id)
           b.profile_id, b.club_id, null::uuid, 'event_cancelled',
           jsonb_build_object(
             'booking_id', b.id,
             'series_id',  target_series,
             'event_id',   e.id,
             'starts_at',  e.starts_at),
           'series_shortened:' || b.id::text
    from public.bookings b
    join public.events e on e.id = b.event_id
    where e.series_id = target_series
      and e.occurrence_date > eff_ends
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and b.status in ('confirmed', 'waitlisted')
    order by b.profile_id, e.occurrence_date, b.id
    on conflict (dedupe_key) do nothing;

    delete from public.events
    where series_id = target_series
      and occurrence_date > eff_ends
      and starts_at > now()
      and status <> 'cancelled';

    update public.event_series
      set materialized_through = least(materialized_through, eff_ends)
      where id = target_series;
  end if;

  -- Extending it, clearing it, or changing nothing, all want the horizon
  -- topped up -- for this series only. With the delete above, this is also
  -- what makes shortening reversible: the freed slots are refilled here the
  -- moment the end date moves back out or goes away.
  perform public.materialize_one_series(target_series);

  return true;
end;
$$;

revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int)
  to authenticated;
