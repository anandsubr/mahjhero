/*
 * Fix pass 1 on 20260823030000.
 *
 * Three changes, all forward-only; 20260823030000 is left exactly as it was.
 *
 *   1. The propagation gate goes back to "did this value actually change",
 *      and the case that argued against it gets its own function
 *      (reset_event_to_series) instead of being folded into a checkbox that
 *      already means something else.
 *   2. "This series is over" stops being expressed by moving `ends_on`, and
 *      becomes its own column, `ended_at`. Materialization looks at that.
 *   3. Nothing here weakens a guard, a lock or an ACL. Every revoke/grant
 *      the replaced functions already carried is restated rather than
 *      assumed, in the house style.
 */

/*
 * ---------------------------------------------------------------------------
 * 1. `ended_at`: the host STOPPED it, as distinct from what the host PLANNED.
 * ---------------------------------------------------------------------------
 *
 * 20260823030000 expressed "this series is over" by writing
 * `ends_on := greatest(current_date, starts_on)`. The `greatest()` was a real
 * fix for a real 23514 (`event_series_ends_after_start` requires
 * `ends_on >= starts_on`, and a host may end a series before its first game),
 * but the shape underneath it was wrong: for a series that starts a year out,
 * `ends_on` lands a year in the FUTURE, so the series still reads as running
 * for a year. The nightly sweep walks it every night, and any
 * `ends_on < current_date` predicate calls it active. The invariant the brief
 * asked for -- one way to say "over", one place materialization looks -- did
 * not hold; it only appeared to for series that had already started.
 *
 * So the two concepts are separated, because they were two concepts all
 * along:
 *
 *   ends_on   -- what the host PLANS: "stop repeating after this date." A
 *                host-authored schedule value, editable through
 *                update_event_series, and never written by end_event_series
 *                again.
 *   ended_at  -- the host STOPPED it, at this instant. Not a schedule value,
 *                not editable, and the single thing materialization checks.
 *
 * With `ends_on` no longer touched by ending a series, the constraint is
 * never at risk and the `greatest()` workaround goes away with the problem
 * it was working around.
 */
alter table public.event_series
  add column if not exists ended_at timestamptz;

comment on column public.event_series.ended_at is
  'When a host stopped this series. Distinct from ends_on, which is the '
  'planned last date. Materialization skips a series with ended_at set.';

/*
 * ---------------------------------------------------------------------------
 * 2. update_event_series: propagate on CHANGE, not on "the caller sent it".
 * ---------------------------------------------------------------------------
 *
 * 20260823030000 gated propagation and override-clearing on
 * `new_x is not null` -- "the caller supplied this field" -- and justified it
 * (in that file's comment above `touched_title`) with this claim about the
 * client:
 *
 *     "a client that resubmits a whole edit form, including fields the host
 *      didn't touch on screen, still only sends non-null for the ones the
 *      form actually has inputs for"
 *
 * That is false for the client this plan specifies, and the correction is
 * recorded here rather than by editing an applied migration: the series edit
 * screen has an input for every propagating field and sends EVERY one of them
 * on every save, so every `touched_x` was unconditionally true. That turned
 * `include_overridden` into a global reset: a host who changed only the
 * title, with the toggle on, lost a venue move, a hand-set time and
 * hand-written notes on a customised week, irreversibly, while the toggle's
 * own copy named specific weeks and specific fields. An action strictly
 * broader than its label, destructive and unrecoverable, is not a propagation
 * bug; it is a consent defect.
 *
 * The gate is therefore `eff_x is distinct from se.x`, compared against the
 * series row as it was BEFORE this edit (`se` is read once, under `for
 * update`, above every write). The spec's sentence holds again: fields this
 * edit did not touch keep their overrides.
 *
 * The gap that argued for the old gate is real and is NOT dismissed: under
 * this gate there is no way to pull a customised week back onto the series,
 * because the edit form shows the series' own unchanged venue and "did this
 * change?" is false. That gets reset_event_to_series below -- two
 * intentions, two controls. The toggle applies ONE edit to customised weeks;
 * Reset undoes ONE week's customisation entirely.
 *
 * Everything else is carried across byte-for-byte: the `for update` on the
 * initial read, the conditional assert_venue_available (see 20260823030000's
 * comment for why an already-attached venue is not re-validated), the
 * `starts_at > now()` / `status <> 'cancelled'` predicates on every
 * propagation statement, and the single `starts_at` key guarding both
 * instants.
 */
create or replace function public.update_event_series(
  target_series      uuid,
  new_title          text default null,
  new_venue_id       uuid default null,
  new_notes          text default null,
  new_start_time     time default null,
  new_duration       int default null,
  new_table_count    int default null,
  new_ends_on        date default null,
  include_overridden boolean default false
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
  touched_title boolean;
  touched_venue boolean;
  touched_notes boolean;
  touched_time  boolean;
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
  eff_ends  := coalesce(new_ends_on, se.ends_on);

  -- The gate. Compared against `se`, the pre-edit snapshot, and computed
  -- before the UPDATE below overwrites the stored row.
  --
  -- The title is trimmed on both sides for the same reason update_event's
  -- override comparison is (20260823030000, fix 3): the stored series title
  -- is only guaranteed trimmed when this function or create_event_series
  -- wrote it, and a whitespace-only difference is not a change a host made.
  touched_title := trim(eff_title) is distinct from trim(se.title);
  touched_venue := eff_venue is distinct from se.venue_id;
  touched_notes := eff_notes is distinct from se.notes;
  touched_time  := eff_start is distinct from se.start_time
                or eff_dur   is distinct from se.duration_minutes;

  -- Unchanged from 20260823030000: assert_venue_available exists to stop
  -- ATTACHING an unreachable venue, so an unchanged venue is not
  -- re-validated. Now identical to `if touched_venue`, but kept written out
  -- against the values rather than the flag, because it is answering a
  -- different question.
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
    ends_on          = eff_ends
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

  -- Clear only the keys this edit actually changed. With the gate above,
  -- "actually changed" now means what the toggle's UI copy says it means.
  if include_overridden then
    update public.events e set overrides = (
      select coalesce(array_agg(k), '{}')
      from unnest(e.overrides) k
      where not (
        (k = 'title'      and touched_title)
        or (k = 'venue_id' and touched_venue)
        or (k = 'notes'    and touched_notes)
        or (k = 'starts_at' and touched_time)
      )
    )
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;

  -- Shortening the run cancels what now falls outside it.
  if eff_ends is not null and eff_ends is distinct from se.ends_on then
    update public.events set status = 'cancelled'
    where series_id = target_series
      and occurrence_date > eff_ends
      and starts_at > now()
      and status <> 'cancelled';

    update public.event_series
      set materialized_through = least(materialized_through, eff_ends)
      where id = target_series;
  end if;

  -- Extending it, or changing nothing, both want the horizon topped up --
  -- for this series only. materialize_one_series is itself a no-op for a
  -- series a host has ended (see below), so editing an ended series cannot
  -- bring its games back.
  perform public.materialize_one_series(target_series);

  return true;
end;
$$;

/*
 * ---------------------------------------------------------------------------
 * 3. reset_event_to_series: one week, all the way back.
 * ---------------------------------------------------------------------------
 *
 * The counterpart to the edit screen's toggle, and the reason that toggle can
 * keep the narrow meaning its label promises. This takes ONE occurrence fully
 * back to its series -- title, venue, notes, and both instants recomputed
 * from `occurrence_date` plus the series' `start_time` resolved in the club's
 * timezone -- and clears `overrides` to `'{}'`.
 *
 * Recomputed, never copied from another row: the series holds a rule (a local
 * time), not an instant, and this occurrence's own date is the only thing
 * that turns one into the other. Copying a sibling's instant would be wrong
 * across a DST boundary.
 *
 * Refuses an event with no `series_id` -- there is nothing to reset to -- and
 * a cancelled event, matching update_event: a cancelled week is not edited
 * back into shape, and the reset would otherwise be the one write that could
 * quietly contradict "cancelled occurrences are never touched".
 *
 * Locking: `for update` on the row it rewrites, the same read-modify-write
 * shape as update_event. The series row is read without a lock and is only
 * ever read: a concurrent update_event_series either commits before this
 * statement's snapshot (we write its new values) or after (it re-propagates
 * over a row whose overrides this function has just cleared, which is exactly
 * what a cleared override means). Neither order loses a write.
 *
 * `authenticated` gets EXECUTE: Task 14 puts a "Reset to the series" button
 * on the event screen.
 */
create function public.reset_event_to_series(target_event uuid)
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

  select * into se from public.event_series where id = ev.series_id;
  select c.timezone into club_tz from public.clubs c where c.id = ev.club_id;

  update public.events set
    title     = se.title,
    venue_id  = se.venue_id,
    notes     = se.notes,
    starts_at = (ev.occurrence_date + se.start_time) at time zone club_tz,
    ends_at   = ((ev.occurrence_date + se.start_time) at time zone club_tz)
                  + make_interval(mins => se.duration_minutes),
    overrides = '{}'
  where id = target_event;

  return true;
end;
$$;

revoke execute on function public.reset_event_to_series(uuid)
  from public, anon;
grant execute on function public.reset_event_to_series(uuid)
  to authenticated;

/*
 * ---------------------------------------------------------------------------
 * 4. end_event_series stops moving `ends_on`.
 * ---------------------------------------------------------------------------
 *
 * `ends_on` is the host's plan and is left alone. `ended_at` records that the
 * host stopped it. The `greatest(current_date, starts_on)` floor is gone
 * along with the write that needed it -- with `ends_on` untouched,
 * `event_series_ends_after_start` is never at risk, and ending a series that
 * has not started yet is an ordinary, boring success.
 *
 * `materialized_through` is still pinned. It is belt-and-braces now that
 * `ended_at` stops materialization outright, and it costs nothing: the
 * partial unique index makes re-materialization a no-op against rows that
 * already exist, so a cancelled week can never come back through this path
 * either.
 *
 * Cancelling future occurrences when `cancel_future` is true is unchanged.
 *
 * Locking: still no `for update`, for the reasons 20260823030000 sets out at
 * length -- and now with one fewer computed value than it had. `ended_at` is
 * `now()`, which reads nothing at all.
 */
create or replace function public.end_event_series(
  target_series uuid,
  cancel_future boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
begin
  select club_id into owning_club
  from public.event_series where id = target_series;

  if owning_club is null then
    raise exception 'no such series' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  update public.event_series
    set ended_at = now(),
        materialized_through = least(materialized_through, current_date)
    where id = target_series;

  if cancel_future then
    update public.events set status = 'cancelled'
    where series_id = target_series
      and starts_at > now()
      and status <> 'cancelled';
  end if;

  return true;
end;
$$;

-- `create or replace` preserves the ACL, but it is restated rather than
-- assumed -- the house rule after 20260822045809, and the reason the portable
-- grants suite asserts it against hosted rather than against a local reset.
revoke execute on function public.end_event_series(uuid, boolean)
  from public, anon;
grant execute on function public.end_event_series(uuid, boolean)
  to authenticated;

/*
 * ---------------------------------------------------------------------------
 * 5. Materialization looks at `ended_at`.
 * ---------------------------------------------------------------------------
 *
 * Both entry points, because both are reachable: the nightly sweep, and
 * materialize_one_series, which create_event_series and update_event_series
 * call directly. Guarding only the sweep would leave a later edit to an ended
 * series generating a fresh occurrence for it.
 *
 * The sweep keeps its `ends_on` predicate as well. That one is the host's
 * plan expiring, which is a different thing from the host stopping the
 * series, and both should end materialization.
 */
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

  -- A series the host has stopped generates nothing, whoever asks and by
  -- whichever door. See 20260823040000's note on ended_at vs ends_on.
  if s.ended_at is not null then
    return 0;
  end if;

  /*
   * The floor at current_date is the fix for the backfill; unchanged from
   * 20260823000000, whose comment explains it in full.
   */
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
      starts_at, ends_at, occurrence_date, created_by
    ) values (
      s.club_id, s.id, s.title, s.venue_id, s.notes,
      (d + s.start_time) at time zone s.club_timezone,
      ((d + s.start_time) at time zone s.club_timezone)
        + make_interval(mins => s.duration_minutes),
      d, s.created_by
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

revoke execute on function public.materialize_one_series(uuid, int)
  from public, anon, authenticated;
grant execute on function public.materialize_one_series(uuid, int)
  to service_role;

create or replace function public.materialize_event_series(horizon_days int default 42)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  s       record;
  created int := 0;
begin
  for s in
    select es.id, es.club_id, es.title
    from public.event_series es
    where es.ended_at is null
      and (es.ends_on is null or es.ends_on >= current_date)
    order by es.id
  loop
    begin
      created := created + public.materialize_one_series(s.id, horizon_days);
    exception when others then
      raise warning
        'materialize_event_series: series % (%) in club % skipped: % [%]',
        s.id, s.title, s.club_id, sqlerrm, sqlstate;
    end;
  end loop;

  return created;
end;
$$;

revoke execute on function public.materialize_event_series(int)
  from public, anon, authenticated;
grant execute on function public.materialize_event_series(int)
  to service_role;
