/*
 * Task 15 (the series edit screen) surfaced a gap `update_event_series` had
 * no way to close: `new_ends_on` follows the same convention as every other
 * parameter here — null means "leave this alone" — so once a series has an
 * `ends_on`, nothing the client can send takes it back to null. On the
 * create screen that was survivable (a host can abandon the form and start
 * over); on a running series "this no longer stops in March" is an ordinary
 * edit with no such escape.
 *
 * A second boolean, `clear_ends_on`, is added rather than repurposing a
 * sentinel date or a distinguished value of `new_ends_on` — `date` has no
 * value that isn't itself a legitimate end date, and function defaults
 * cannot tell "the caller passed null" apart from "the caller passed
 * nothing", so there is no way to smuggle "clear" through the existing
 * parameter without colliding with "leave alone". `clear_ends_on` takes
 * precedence over `new_ends_on` when both are somehow sent together, which
 * only matters for a caller behaving strangely — the edit screen this
 * function was written for never sends both.
 *
 * Appended as the LAST parameter, after `include_overridden`, specifically
 * so every existing positional call — this file's own fixture included —
 * keeps working unchanged; the new parameter's default (`false`) reproduces
 * today's behaviour exactly for anyone not passing it.
 *
 * Postgres cannot `create or replace` its way to an added parameter (see
 * 20260823070000's note on this: a changed parameter list is a different
 * function, and `create or replace` either errors or leaves a second
 * overload behind for PostgREST to trip over as PGRST203). This function is
 * therefore DROPped and re-CREATEd, which also drops its ACL — restated at
 * the bottom of this file, the house rule after 20260822045809,
 * 20260823000000 and 20260823070000 all hit the same trap.
 *
 * Nothing else about the function changes. Every guard, lock, propagation
 * rule and comment carries across from 20260823040000 (the function's
 * newest prior definition) unmodified; the diff against it is exactly the
 * new parameter, the new `eff_ends` computation, and the ACL restatement.
 */
drop function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean);

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
  -- The one addition. `clear_ends_on` wins over `new_ends_on` outright —
  -- there is no reading of "clear it AND set it to this date" that makes
  -- sense, so precedence, not an error, is the simplest correct answer.
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

  -- Shortening the run cancels what now falls outside it. `eff_ends is not
  -- null` is what keeps this branch from firing when the run is instead
  -- being UNCAPPED (clear_ends_on, or a plain widening new_ends_on) — there
  -- is nothing to cancel when the boundary just moved to infinity.
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

  -- Extending it, clearing it, or changing nothing, all want the horizon
  -- topped up — for this series only.
  perform public.materialize_one_series(target_series);

  return true;
end;
$$;

-- The ACL the DROP above destroyed. Restated rather than assumed — see the
-- file-level comment.
revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean)
  from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean, boolean)
  to authenticated;
