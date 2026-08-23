/*
 * Shortening a series' run must DELETE the weeks that fall outside it, not
 * cancel them.
 *
 * The defect, verified against this stack before the change:
 *
 *   A. open-ended weekly:  25 Aug, 1, 8, 15, 22, 29 Sep -- all published
 *   B. cap ends_on to +14:  8, 15, 22, 29 Sep           -- all CANCELLED
 *   C. clear ends_on again:  8, 15, 22, 29 Sep          -- STILL cancelled
 *
 * Step C is the edit screen's "Runs indefinitely" toggle
 * (20260823080000), and it re-materializes -- but the cancelled rows still
 * occupy their `(series_id, occurrence_date)` slots, so
 * materialize_one_series' `on conflict ... do nothing` skips them forever.
 * The result is a permanent hole in the run, rendered to every member as
 * "Cancelled" cards, that no function and no screen can recover.
 *
 * Cancelling was the wrong verb, not merely the wrong mechanism. Cancelling a
 * game is a statement to the members who were told it was on: it is off, and
 * the spec is explicit that it "is a different kind of statement and is
 * treated as one everywhere". A week beyond the host's new end date was never
 * cancelled by anybody -- it simply is not part of the run any more. Deleting
 * it says exactly that, and it frees the slot, so clearing or extending the
 * end date refills the run for free with no new machinery at all.
 *
 * ---------------------------------------------------------------------------
 * What is deleted, and what deliberately is not
 * ---------------------------------------------------------------------------
 *
 *   - FUTURE only (`starts_at > now()`). Past occurrences are history. The
 *     same guard the cancel branch carried, kept verbatim: pulling ends_on
 *     back before a week that has already happened must not rewrite it.
 *
 *   - NON-CANCELLED only (`status <> 'cancelled'`). A week the host
 *     deliberately cancelled is a statement they made, and it outlives the
 *     shortening: the row stays, cancelled, in its slot. Which also means
 *     clearing the end date later does NOT resurrect it -- correct, and the
 *     same rule materialization has always followed.
 *
 *   - CUSTOMISED weeks (non-empty `overrides`) ARE deleted, along with their
 *     customisation. The alternative considered was detaching them to
 *     one-off events (`series_id = null`), which preserves the host's typing.
 *     Rejected for two reasons. First, it contradicts the edit that was just
 *     made: the host said this run stops on the 14th, and a detached game
 *     would go on standing on the 28th with no series left to explain why.
 *     Second, and decisively, it breaks the restoration this whole change
 *     exists to buy: `events_occurrence_requires_series` forces a detached
 *     row's `occurrence_date` to null, so it no longer occupies the slot, and
 *     clearing the end date would materialize a SECOND game that same evening
 *     -- a duplicate, which is a worse and much less legible outcome than a
 *     lost venue override. Deleting keeps one rule for the whole set: beyond
 *     the new end, and not cancelled, means gone.
 *
 * `event_tables` rows follow via the composite foreign key's
 * `on delete cascade` (20260822194000), so no second statement is needed.
 *
 * ---------------------------------------------------------------------------
 * What is NOT changed
 * ---------------------------------------------------------------------------
 *
 * `end_event_series` keeps CANCELLING. "I am stopping this series" is a
 * different act from "it now ends earlier": members were told those games
 * were on, and a host who ends a series is telling them it is off, not
 * quietly removing the evidence. That function is untouched here.
 *
 * Everything else in this function -- every guard, lock, propagation rule and
 * comment -- carries across from 20260823080000 unmodified. `create or
 * replace` rather than drop/create, because the parameter list is identical;
 * the ACL therefore survives, and is restated at the bottom anyway, which is
 * this branch's standing rule after 20260822045809, 20260823000000,
 * 20260823070000 and 20260823080000 each rediscovered the same trap.
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
  include_overridden boolean default false,
  clear_ends_on      boolean default false
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
  -- `clear_ends_on` wins over `new_ends_on` outright -- there is no reading
  -- of "clear it AND set it to this date" that makes sense, so precedence,
  -- not an error, is the simplest correct answer.
  eff_ends  := case when clear_ends_on then null
                    else coalesce(new_ends_on, se.ends_on) end;

  -- The gate. Compared against `se`, the pre-edit snapshot, and computed
  -- before the UPDATE below overwrites the stored row.
  touched_title := trim(eff_title) is distinct from trim(se.title);
  touched_venue := eff_venue is distinct from se.venue_id;
  touched_notes := eff_notes is distinct from se.notes;
  touched_time  := eff_start is distinct from se.start_time
                or eff_dur   is distinct from se.duration_minutes;

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
      )
    )
    where e.series_id = target_series
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;

  -- Shortening the run REMOVES what now falls outside it -- see the
  -- file-level comment for why deleting, not cancelling, is the correct verb
  -- and what it buys. `eff_ends is not null` is what keeps this branch from
  -- firing when the run is instead being UNCAPPED (clear_ends_on, or a plain
  -- widening new_ends_on): there is nothing outside a boundary at infinity.
  -- A widening new_ends_on does enter this branch and matches no rows, which
  -- is correct and costs one indexed delete.
  if eff_ends is not null and eff_ends is distinct from se.ends_on then
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

-- Restated rather than assumed. `create or replace` preserves the existing
-- ACL because the parameter list is unchanged, so these are a no-op today --
-- which is the point: they are also what makes that true independently of
-- whether the ACL survived, and they are checked against hosted by
-- supabase/tests/database/portable/grants.test.sql.
revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean)
  to authenticated;
