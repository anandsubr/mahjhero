/*
 * Threads Task 1's seating_mode/capacity through the rest of an occurrence's
 * lifecycle: editing a single event, editing a whole series, materializing
 * new occurrences, and resetting an overridden occurrence back to its
 * series. Four functions, each copied verbatim from its current definition
 * and extended only where noted below.
 *
 * ---------------------------------------------------------------------
 * The pre-existing bug this migration also fixes.
 * ---------------------------------------------------------------------
 * reset_event_to_series (last touched by 20260903180000, which restored
 * check_in_required/fee_cents/min_spend_cents after THEY were added without
 * updating this function) was never updated when game_mode was added by
 * 20260905060000_game_mode.sql. So resetting an occurrence whose game_mode
 * had been overridden cleared `overrides` to '{}' while leaving the stale
 * overridden game_mode value in place -- exactly the bug 20260903180000's
 * own header describes, one field later. Adding seating_mode/capacity here
 * without also adding game_mode would ship a third instance of the same
 * bug, so all three are restored together below.
 *
 * ---------------------------------------------------------------------
 * The capacity null-semantics trap.
 * ---------------------------------------------------------------------
 * Every other "new_*" argument on update_event/update_event_series treats
 * null as "not supplied, leave alone". capacity's own null means "uncapped",
 * a real target value -- those two readings collide. Both functions gain a
 * separate `clear_capacity boolean default false`: when true, capacity is
 * set to null; otherwise a null new_capacity means "leave alone". This is
 * also why update_event's override-recording check below compares
 * eff_capacity (which already resolves clear_capacity) against ev.capacity,
 * rather than comparing the raw new_capacity argument the way the other
 * fields compare their raw new_* argument -- a raw-argument comparison
 * cannot tell "not touched, capacity already set" from "explicitly cleared"
 * and would misfile every unrelated edit of an already-capacitated
 * occurrence as a capacity override. eff_capacity already encodes "did this
 * call actually mean to change capacity", exactly like every touched_*
 * variable in update_event_series does for the same reason.
 */

-- ---------------------------------------------------------------------------
-- materialize_one_series
--
-- Signature unchanged, so create or replace. Body from
-- 20260905060000_game_mode.sql:44-127, carrying seating_mode and capacity
-- onto each occurrence exactly the way game_mode already is.
-- generate_series(1, s.table_count) needs no change: an open-seating series
-- with table_count = 0 already yields zero event_tables rows today.
-- ---------------------------------------------------------------------------
create or replace function public.materialize_one_series(
  target_series uuid,
  horizon_days  int default 42
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s            record;
  d            date;
  new_event    uuid;
  created      int := 0;
  window_start date;
  window_end   date;
begin
  select es.*, c.timezone as club_timezone
    into s
    from public.event_series es
    join public.clubs c on c.id = es.club_id
    where es.id = target_series;

  if not found then
    return 0;
  end if;

  if s.ended_at is not null then
    return 0;
  end if;

  window_start := greatest(
    s.starts_on,
    coalesce(s.materialized_through + 1, s.starts_on),
    current_date
  );
  window_end := least(
    current_date + horizon_days,
    coalesce(s.ends_on, current_date + horizon_days)
  );

  if window_end < window_start then
    return 0;
  end if;

  for d in
    select * from public.series_occurrence_dates(
      s.frequency, s.weekday, s.nth_week,
      s.starts_on, s.ends_on, window_start, window_end
    )
  loop
    new_event := null;

    insert into public.events (
      club_id, series_id, title, venue_id, notes,
      starts_at, ends_at, occurrence_date, check_in_required,
      fee_cents, min_spend_cents, game_mode, seating_mode, capacity,
      created_by
    ) values (
      s.club_id, s.id, s.title, s.venue_id, s.notes,
      (d + s.start_time) at time zone s.club_timezone,
      ((d + s.start_time) at time zone s.club_timezone)
        + make_interval(mins => s.duration_minutes),
      d, s.check_in_required, s.fee_cents, s.min_spend_cents, s.game_mode,
      s.seating_mode, s.capacity,
      s.created_by
    )
    on conflict (series_id, occurrence_date) where series_id is not null
    do nothing
    returning id into new_event;

    if new_event is not null then
      insert into public.event_tables (event_id, club_id, label, position)
      select new_event, s.club_id, 'Table ' || g, g
      from generate_series(1, s.table_count) g;

      created := created + 1;
    end if;
  end loop;

  update public.event_series
    set materialized_through = window_end
    where id = s.id;

  return created;
end;
$$;

-- create or replace preserves the ACL, but it is restated per the house
-- rule. Internal: granted only to service_role (20260823040000).
revoke execute on function public.materialize_one_series(uuid, int)
  from public, anon, authenticated;
grant execute on function public.materialize_one_series(uuid, int)
  to service_role;

-- ---------------------------------------------------------------------------
-- update_event
--
-- Signature changes, so drop + create. Body from
-- 20260905110000_event_game_mode_mutations.sql, plus new_seating_mode,
-- new_capacity and clear_capacity trailing arguments, an eff_seating/
-- eff_capacity resolution, two more override-recording blocks, and
-- seating_mode/capacity added to the final UPDATE.
-- ---------------------------------------------------------------------------
drop function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int, public.game_mode);

create function public.update_event(
  target_event          uuid,
  new_title             text default null,
  new_venue_id          uuid default null,
  new_notes             text default null,
  new_date              date default null,
  new_start_time        time default null,
  new_duration_minutes  int default null,
  new_check_in_required boolean default null,
  new_fee_cents         int default null,
  new_min_spend_cents   int default null,
  new_game_mode         public.game_mode default null,
  new_seating_mode      public.seating_mode default null,
  new_capacity          int default null,
  clear_capacity        boolean default false
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
  eff_game_mode  public.game_mode;
  eff_seating    public.seating_mode;
  eff_capacity   int;
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
  eff_game_mode := coalesce(new_game_mode, ev.game_mode);
  eff_seating := coalesce(new_seating_mode, ev.seating_mode);
  -- See the file-level comment: clear_capacity wins outright, exactly the
  -- same precedence clear_ends_on already has over new_ends_on in
  -- update_event_series.
  eff_capacity := case when clear_capacity then null
                       else coalesce(new_capacity, ev.capacity) end;

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
    if new_game_mode is not null
       and new_game_mode is distinct from ev.game_mode then
      next_overrides := array_append(next_overrides, 'game_mode');
    end if;
    if new_seating_mode is not null
       and new_seating_mode is distinct from ev.seating_mode then
      next_overrides := array_append(next_overrides, 'seating_mode');
    end if;
    -- Not "new_capacity is distinct from ev.capacity": a raw comparison of
    -- the argument cannot tell "capacity not touched by this call" from
    -- "explicitly cleared to null" (both leave new_capacity null). eff_capacity
    -- already resolves clear_capacity, so it reads as "not touched" (equal to
    -- ev.capacity) exactly when this call did not mean to change it -- see the
    -- file-level comment.
    if eff_capacity is distinct from ev.capacity then
      next_overrides := array_append(next_overrides, 'capacity');
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
    game_mode          = eff_game_mode,
    seating_mode       = eff_seating,
    capacity           = eff_capacity,
    overrides          = next_overrides
  where id = target_event;

  return true;
end;
$$;

revoke execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int, public.game_mode,
  public.seating_mode, int, boolean)
  from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, date, time, int, boolean, int, int, public.game_mode,
  public.seating_mode, int, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- update_event_series
--
-- Signature changes, so drop + create. Body from
-- 20260905110000_event_game_mode_mutations.sql, plus new_seating_mode,
-- new_capacity and clear_capacity trailing arguments, a touched_seating_mode/
-- touched_capacity pair, two propagation blocks shaped exactly like
-- touched_game_mode's, two clauses in the override-clearing unnest, and
-- seating_mode/capacity added to the series' own UPDATE.
-- ---------------------------------------------------------------------------
drop function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int,
  int, public.game_mode);

create function public.update_event_series(
  target_series         uuid,
  new_title             text default null,
  new_venue_id          uuid default null,
  new_notes             text default null,
  new_start_time        time default null,
  new_duration          int default null,
  new_table_count       int default null,
  new_ends_on           date default null,
  include_overridden    boolean default false,
  clear_ends_on         boolean default false,
  new_check_in_required boolean default null,
  new_fee_cents         int default null,
  new_min_spend_cents   int default null,
  new_game_mode         public.game_mode default null,
  new_seating_mode      public.seating_mode default null,
  new_capacity          int default null,
  clear_capacity        boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  se                  public.event_series;
  club_tz             text;
  eff_title           text;
  eff_venue           uuid;
  eff_notes           text;
  eff_start           time;
  eff_dur             int;
  eff_count           int;
  eff_ends            date;
  eff_check_in        boolean;
  eff_fee             int;
  eff_min_spend       int;
  eff_game_mode       public.game_mode;
  eff_seating_mode    public.seating_mode;
  eff_capacity        int;
  touched_title       boolean;
  touched_venue       boolean;
  touched_notes       boolean;
  touched_time        boolean;
  touched_check_in    boolean;
  touched_fee         boolean;
  touched_min_spend   boolean;
  touched_game_mode   boolean;
  touched_seating_mode boolean;
  touched_capacity    boolean;
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
  eff_game_mode := coalesce(new_game_mode, se.game_mode);
  eff_seating_mode := coalesce(new_seating_mode, se.seating_mode);
  -- Same clear_capacity-wins precedence as update_event; see the file-level
  -- comment on the capacity null-semantics trap.
  eff_capacity := case when clear_capacity then null
                       else coalesce(new_capacity, se.capacity) end;
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
  touched_game_mode := eff_game_mode is distinct from se.game_mode;
  touched_seating_mode := eff_seating_mode is distinct from se.seating_mode;
  touched_capacity := eff_capacity is distinct from se.capacity;

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
    min_spend_cents  = eff_min_spend,
    game_mode        = eff_game_mode,
    seating_mode     = eff_seating_mode,
    capacity         = eff_capacity
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

  if touched_game_mode then
    update public.events e set game_mode = eff_game_mode
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('game_mode' = any(e.overrides)));
  end if;

  if touched_seating_mode then
    update public.events e set seating_mode = eff_seating_mode
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('seating_mode' = any(e.overrides)));
  end if;

  if touched_capacity then
    update public.events e set capacity = eff_capacity
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('capacity' = any(e.overrides)));
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
        or (k = 'game_mode' and touched_game_mode)
        or (k = 'seating_mode' and touched_seating_mode)
        or (k = 'capacity' and touched_capacity)
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
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode, public.seating_mode, int, boolean)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode, public.seating_mode, int, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- reset_event_to_series
--
-- Signature unchanged (same single target_event uuid argument, same returns
-- boolean), so create or replace, not drop-and-recreate. Body copied
-- byte-for-byte from 20260903180000_reset_event_to_series_all_fields.sql:
-- 18-75, with three new assignments added to the update list.
--
-- game_mode is one of the three: it was added to events by 20260905060000,
-- after 20260903180000 last touched this function, and never backfilled
-- here -- so resetting an occurrence with an overridden game_mode cleared
-- `overrides` while leaving the stale game_mode value in place. Fixed here,
-- in a seating-mode migration, because seating_mode/capacity would
-- otherwise ship the identical bug for a third and fourth field one
-- migration after finding it.
-- ---------------------------------------------------------------------------
create or replace function public.reset_event_to_series(target_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ev      public.events;
  se      public.event_series;
  club_tz text;
begin
  select * into ev from public.events where id = target_event for update;

  if ev.id is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(ev.club_id);

  if ev.series_id is null then
    raise exception 'this event is not part of a series'
      using errcode = '42501';
  end if;
  if ev.status = 'cancelled' then
    raise exception 'a cancelled event cannot be edited'
      using errcode = '42501';
  end if;
  if ev.starts_at <= now() then
    raise exception 'a past occurrence is history and cannot be reset'
      using errcode = '42501';
  end if;

  select * into se from public.event_series where id = ev.series_id;
  select c.timezone into club_tz from public.clubs c where c.id = ev.club_id;

  update public.events set
    title              = se.title,
    venue_id           = se.venue_id,
    notes              = se.notes,
    starts_at          = (ev.occurrence_date + se.start_time) at time zone club_tz,
    ends_at            = ((ev.occurrence_date + se.start_time) at time zone club_tz)
                            + make_interval(mins => se.duration_minutes),
    check_in_required  = se.check_in_required,
    fee_cents          = se.fee_cents,
    min_spend_cents    = se.min_spend_cents,
    -- The pre-existing bug this migration fixes: game_mode was added by
    -- 20260905060000, after this function was last written, and never
    -- restored here until now. See the file-level comment above.
    game_mode          = se.game_mode,
    seating_mode       = se.seating_mode,
    capacity           = se.capacity,
    overrides = '{}'
  where id = target_event;

  return true;
end;
$$;

-- `create or replace` preserves the ACL, but it is restated rather than
-- assumed -- the house rule after 20260822045809.
revoke execute on function public.reset_event_to_series(uuid)
  from public, anon;
grant execute on function public.reset_event_to_series(uuid)
  to authenticated;
