/*
 * The "Updated" tag on game rows (club-hub redesign, phase 6).
 *
 * events.details_changed_at: null until a host changes one of a game's
 * DETAILS -- starts_at, ends_at, venue_id, title or notes -- and then the
 * instant of the latest such change. Compared old vs new: title and notes as
 * trimmed text, the rest with IS DISTINCT FROM. A save that changes none of
 * them (capacity only, fee only, or the same values re-saved) leaves it
 * untouched. Only update_event and update_event_series write it; their
 * bodies below are copied verbatim from their latest definitions
 * (update_event: 20260906160000_capacity_guard_on_update.sql;
 * update_event_series: 20260924103100_series_shortening_tells_the_invited.sql)
 * with only the details_changed_at assignments added, each marked "-- ADDED".
 *
 * event_views: one row per (person, game), seen_at = the last time they
 * opened its Game detail. Written only by mark_event_seen; no direct access.
 *
 * my_games / club_games gain a trailing `updated boolean`:
 *   not past (starts_at >= now(), the club Games section's own `past` test)
 *   AND details_changed_at within the last 14 days
 *   AND details_changed_at > created_at + 1 hour (a host's set-up edits don't
 *       flag a brand-new game for everyone)
 *   AND no event_views row for the caller with seen_at >= details_changed_at.
 * Adding a return column changes the return type, so both are dropped and
 * recreated (bodies otherwise copied verbatim from 20260929100100 /
 * 20260930100000) and re-granted exactly as before. No view or function
 * depends on either.
 */

alter table public.events add column details_changed_at timestamptz;

create table public.event_views (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_id   uuid not null references public.events(id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (profile_id, event_id)
);
alter table public.event_views enable row level security;
-- No policies and no grants: only mark_event_seen and the two feeds (all
-- security definer) touch it. Supabase grants ALL on new tables by default.
revoke all on public.event_views from public, anon, authenticated;
create index event_views_event_id_idx on public.event_views (event_id);

-- ---------------------------------------------------------------------------
-- mark_event_seen: Game detail calls it on load. The caller must be able to
-- read the game under events_select_member (20260905080000, with
-- event_has_my_active_booking widened to invites by 20260924104000); a game
-- that does not exist or that the caller cannot see is the same refusal.
-- ---------------------------------------------------------------------------
create function public.mark_event_seen(target_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.events e
    where e.id = target_event
      and public.is_club_member(e.club_id)
      and (e.status <> 'draft' or public.is_club_organizer(e.club_id))
      and (e.game_mode = 'open_play'
           or public.is_club_organizer(e.club_id)
           or public.event_has_my_active_booking(e.id))
  ) then
    raise exception 'no such event' using errcode = '42501';
  end if;

  insert into public.event_views (profile_id, event_id, seen_at)
  values (auth.uid(), target_event, now())
  on conflict (profile_id, event_id) do update set seen_at = excluded.seen_at;
end;
$$;
revoke execute on function public.mark_event_seen(uuid) from public, anon;
grant execute on function public.mark_event_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_event
-- ---------------------------------------------------------------------------
create or replace function public.update_event(
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

  -- The new guard (this migration). Mirrors create_event's own
  -- `capacity_limit is not null and capacity_limit < 1` check
  -- (20260906120000_seating_mode_create.sql), reading the resolved
  -- `eff_capacity` rather than the raw argument for the reason the
  -- file-level comment above gives.
  if eff_capacity is not null and eff_capacity < 1 then
    raise exception 'capacity must be at least one' using errcode = '23514';
  end if;

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
    overrides          = next_overrides,
    -- ADDED: stamp only when a detail actually changes.
    details_changed_at = case
      when trim(eff_title) is distinct from trim(ev.title)
        or eff_venue is distinct from ev.venue_id
        or trim(eff_notes) is distinct from trim(ev.notes)
        or eff_starts is distinct from ev.starts_at
        or eff_ends is distinct from ev.ends_at
      then now()
      else ev.details_changed_at
    end
  where id = target_event;

  return true;
end;
$$;

-- `create or replace` preserves the ACL, but it is restated per the house
-- rule, with the full argument type list.
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
-- ---------------------------------------------------------------------------
create or replace function public.update_event_series(
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

  -- The new guard (this migration). Mirrors update_event's own, and
  -- create_event_series' sibling create_event's `capacity_limit < 1` check
  -- -- see the file-level comment above.
  if eff_capacity is not null and eff_capacity < 1 then
    raise exception 'capacity must be at least one' using errcode = '23514';
  end if;

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
    update public.events e set title = trim(eff_title),
      -- ADDED
      details_changed_at = case when trim(e.title) is distinct from trim(eff_title)
                                then now() else e.details_changed_at end
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('title' = any(e.overrides)));
  end if;

  if touched_venue then
    update public.events e set venue_id = eff_venue,
      -- ADDED
      details_changed_at = case when e.venue_id is distinct from eff_venue
                                then now() else e.details_changed_at end
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled'
      and (include_overridden or not ('venue_id' = any(e.overrides)));
  end if;

  if touched_notes then
    update public.events e set notes = eff_notes,
      -- ADDED
      details_changed_at = case when trim(e.notes) is distinct from trim(eff_notes)
                                then now() else e.details_changed_at end
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
                    + make_interval(mins => eff_dur),
      -- ADDED
      details_changed_at = case
        when e.starts_at is distinct from
               (e.occurrence_date + eff_start) at time zone club_tz
          or e.ends_at is distinct from
               ((e.occurrence_date + eff_start) at time zone club_tz)
                 + make_interval(mins => eff_dur)
        then now() else e.details_changed_at end
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
      and b.status in ('confirmed', 'waitlisted', 'invited')  -- CHANGED
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

-- `create or replace` preserves the ACL, but it is restated per the house
-- rule, with the full argument type list.
revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode, public.seating_mode, int, boolean)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean, boolean, int, int,
  public.game_mode, public.seating_mode, int, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- my_games
-- ---------------------------------------------------------------------------
drop function public.my_games(timestamptz, timestamptz);
create function public.my_games(from_ts timestamptz, to_ts timestamptz)
returns table (
  event_id          uuid,
  club_id           uuid,
  club_name         text,
  title             text,
  game_mode         public.game_mode,
  seating_mode      public.seating_mode,
  starts_at         timestamptz,
  ends_at           timestamptz,
  club_timezone     text,
  venue_name        text,
  seats_taken       int,
  capacity          int,
  capped            boolean,
  my_status         text,
  waitlist_position int,
  table_label       text,
  updated           boolean
)
language sql
security definer
stable
set search_path = public
as $$
  with mine as (
    select b.event_id, b.status, b.group_id, t.label as table_label
    from public.bookings b
    left join public.event_tables t on t.id = b.event_table_id
    where b.profile_id = auth.uid()
      and b.status in ('confirmed', 'waitlisted')
  )
  select
    e.id, e.club_id, c.name, e.title, e.game_mode, e.seating_mode,
    e.starts_at, e.ends_at, c.timezone, v.name,
    (public.event_confirmed_seats(e.id)
      + (select count(*)::int from public.bookings ib
          where ib.event_id = e.id and ib.status = 'invited' and ib.invite_holds_seat))::int,
    public.event_capacity(e.id),
    public.event_is_capped(e.id),
    case
      when e.created_by = auth.uid() then 'hosting'
      when m.status = 'confirmed' then 'going'
      else 'waitlisted'
    end,
    case when e.created_by <> auth.uid() and m.status = 'waitlisted' then (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    m.table_label,
    -- ADDED: see the file-level comment for the rule.
    coalesce((e.starts_at >= now()
     and e.details_changed_at >= now() - interval '14 days'
     and e.details_changed_at > e.created_at + interval '1 hour'
     and not exists (
       select 1 from public.event_views ev
       where ev.profile_id = auth.uid() and ev.event_id = e.id
         and ev.seen_at >= e.details_changed_at)), false)
  from public.events e
  join public.clubs c on c.id = e.club_id
  join public.venues v on v.id = e.venue_id
  left join mine m on m.event_id = e.id
  left join public.booking_groups g on g.id = m.group_id
  where e.status = 'published'
    and e.starts_at >= from_ts
    and e.starts_at < to_ts
    and (m.event_id is not null or e.created_by = auth.uid())
    and public.is_club_member(e.club_id)
    and (e.game_mode = 'open_play'
         or public.is_club_organizer(e.club_id)
         or public.event_has_my_active_booking(e.id))
  order by e.starts_at, c.name;
$$;
revoke execute on function public.my_games(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_games(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- club_games
-- ---------------------------------------------------------------------------
drop function public.club_games(uuid, timestamptz, timestamptz);
create function public.club_games(target_club uuid, from_ts timestamptz, to_ts timestamptz)
returns table (
  event_id uuid, club_id uuid, club_name text, title text,
  game_mode public.game_mode, seating_mode public.seating_mode,
  starts_at timestamptz, ends_at timestamptz, club_timezone text, venue_name text,
  seats_taken int, capacity int, capped boolean, my_status text,
  waitlist_position int, table_label text, notes text, updated boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_club_member(target_club) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  return query
  with mine as (
    select b.event_id, b.status, b.group_id, t.label as table_label
    from public.bookings b
    left join public.event_tables t on t.id = b.event_table_id
    where b.profile_id = auth.uid()
      and b.club_id = target_club
      and b.status in ('confirmed', 'waitlisted', 'invited')
  )
  select
    e.id, e.club_id, c.name, e.title, e.game_mode, e.seating_mode,
    e.starts_at, e.ends_at, c.timezone, v.name,
    (public.event_confirmed_seats(e.id)
      + (select count(*)::int from public.bookings ib
          where ib.event_id = e.id and ib.status = 'invited' and ib.invite_holds_seat))::int,
    public.event_capacity(e.id),
    public.event_is_capped(e.id),
    case
      when e.created_by = auth.uid() then 'hosting'
      when m.status = 'confirmed' then 'going'
      when m.status = 'waitlisted' then 'waitlisted'
      when m.status = 'invited' then 'invited'
      else 'not'
    end,
    case when e.created_by <> auth.uid() and m.status = 'waitlisted' then (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    m.table_label,
    e.notes,
    -- ADDED: same rule as my_games.
    coalesce((e.starts_at >= now()
     and e.details_changed_at >= now() - interval '14 days'
     and e.details_changed_at > e.created_at + interval '1 hour'
     and not exists (
       select 1 from public.event_views ev
       where ev.profile_id = auth.uid() and ev.event_id = e.id
         and ev.seen_at >= e.details_changed_at)), false)
  from public.events e
  join public.clubs c on c.id = e.club_id
  join public.venues v on v.id = e.venue_id
  left join mine m on m.event_id = e.id
  left join public.booking_groups g on g.id = m.group_id
  where e.club_id = target_club
    and e.status = 'published'
    and e.starts_at >= from_ts
    and e.starts_at < to_ts
    and (e.game_mode = 'open_play'
         or public.is_club_organizer(e.club_id)
         or public.event_has_my_active_booking(e.id))
  order by e.starts_at;
end;
$$;
revoke execute on function public.club_games(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.club_games(uuid, timestamptz, timestamptz) to authenticated;
