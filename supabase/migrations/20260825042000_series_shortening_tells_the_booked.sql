/*
 * Shortening a series deletes the occurrences it drops (20260824000000) --
 * correctly; that migration's own comment explains why deleting, not
 * cancelling, is the right verb for a week that was never part of the run
 * to begin with. That was harmless when it shipped, because bookings did
 * not exist yet. Bookings exist now, and the delete cascades into them
 * (bookings' composite FK to events, on delete cascade), so a host
 * shortening a run can silently unseat members with no notification and no
 * record. This plan's own rule, stated for cancel_event two migrations
 * ago, is that nobody is silently ejected from a game they were coming to.
 * A deleted-out-from-under-them occurrence is exactly that.
 *
 * The fix is one INSERT before the DELETE: one 'event_cancelled' outbox
 * row per distinct member who still holds a confirmed or waitlisted
 * booking on any occurrence about to be removed -- reusing the same kind
 * cancel_event uses, because from the member's seat this is the same fact
 * ("the game you were coming to is off"), just reached by a different
 * host action.
 *
 * The trap: `notification_outbox.event_id` references `events(id) ON
 * DELETE CASCADE` (20260825000000). An outbox row that points at the very
 * occurrence the DELETE below is about to remove is deleted right along
 * with it -- destroying the record this migration exists to create,
 * silently, in the same statement that caused the problem. The column is
 * nullable for exactly this: write the row with event_id = null and carry
 * the occurrence's id, its start time, and the series id in the payload
 * jsonb instead, so the notification outlives the row that caused it.
 *
 * One row per member, not per booking: a member could hold live bookings
 * on more than one of the occurrences being dropped in the same edit, and
 * one "your seats beyond the new date are gone" is the correct number of
 * things to tell them, not one per booking. `distinct on (b.profile_id)`,
 * ordered by the earliest affected occurrence, picks a single
 * representative booking per member; dedupe_key is built from THAT
 * booking's id, so it stays stable if this ever needs to run again with
 * the same inputs, and unique per member per shortening the same way
 * cancel_event's dedupe_key is unique per member per cancellation.
 *
 * Everything else in this function is 20260824000000 unmodified --
 * signature, guards, propagation, the delete and materialize calls below
 * it. `create or replace` rather than drop/create, same reason as always:
 * the parameter list is identical, so the ACL survives, and is restated at
 * the bottom anyway per this branch's standing rule.
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
