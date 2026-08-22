/*
 * One conversion, in one place: Postgres.
 *
 * Until now a one-off event and a recurring series disagreed about WHO turns
 * a club-local calendar date and a wall-clock time into an instant. A series
 * hands `starts_on`/`start_time` to the database and lets
 * materialize_one_series resolve them with
 * `(date + time) at time zone clubs.timezone`. A one-off event had the
 * CLIENT do the same arithmetic in JavaScript and post the resulting
 * timestamptz. Two implementations of one conversion, required to agree
 * forever.
 *
 * They did not agree. The second attempt at the JavaScript half still
 * disagreed with Postgres in 233 of 3,920 date/time/club-zone/device-zone
 * combinations, 219 of them at ordinary unambiguous wall clocks — a 7pm
 * Tokyo game landing an hour off. There is no third attempt that is worth
 * making, because the class of bug is the duplication, not the expression.
 *
 * So `create_event` and `update_event` now take the same calendar values the
 * series functions take, and compute the instants with the identical
 * expression materialize_one_series uses. The client sends the digits the
 * host picked and nothing else; there is one conversion left in the system.
 *
 * Two mechanical notes, both learned the hard way on this branch:
 *
 *   1. Postgres will not re-signature a function through
 *      `create or replace` — a changed parameter list is a different
 *      function, and `create or replace` either errors or silently leaves a
 *      second overload behind (which PostgREST then refuses to resolve,
 *      PGRST203). Both functions are therefore DROPped and re-CREATEd.
 *
 *   2. `drop function` takes the ACL with it, and a freshly created function
 *      is EXECUTE-to-PUBLIC (a null proacl) locally and EXECUTE-to-anon
 *      directly on hosted, where Supabase's bootstrap grants it. Both
 *      functions therefore restate `revoke ... from public, anon` and
 *      `grant ... to authenticated` at the bottom of this file. Without
 *      that, this migration would quietly open both mutations to anonymous
 *      callers. 20260822045809 and 20260823020000 both record earlier
 *      versions of this same trap.
 *
 * `authenticated` still holds `select` on the event tables and nothing else.
 * Every guard, lock and check below is carried across unchanged from
 * 20260823030000 (the newest definition of each function); what changes is
 * only how `starts_at`/`ends_at` are arrived at.
 */

-- ---------------------------------------------------------------------------
-- create_event
-- ---------------------------------------------------------------------------

drop function public.create_event(
  uuid, text, uuid, text, timestamptz, timestamptz, int);

create function public.create_event(
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

/*
 * The edit screen (Task 15) is not written yet, and that is exactly why this
 * function is re-signatured now rather than later: left taking instants, it
 * would need the same client-side conversion that has just been deleted, and
 * the bug would come back a third time through a different door.
 *
 * Everything else is unchanged and deliberate:
 *
 *   - `for update` on the read (20260823020000's lost-update fix).
 *   - assert_club_organizer against the event's OWN club.
 *   - The venue is only re-asserted when it actually changes
 *     (20260823030000's fix 1), so a foreign club flipping a public venue to
 *     club-only cannot freeze this club's edits.
 *   - The title override compares TRIMMED against TRIMMED
 *     (20260823030000's fix 3).
 *   - A cancelled event refuses edits.
 *   - `starts_at` is one override key covering BOTH instants.
 *
 * A null argument still means "leave this alone". For the three calendar
 * arguments that is stronger than a coalesce per field: when all three are
 * null the stored instants are carried across BYTE-FOR-BYTE rather than
 * round-tripped through the club's zone. A round trip is not the identity
 * function on the hour that repeats at a fall-back transition — 01:30 EDT
 * and 01:30 EST are the same local timestamp, and `at time zone` has to pick
 * one — so a title-only edit of a game inside that hour would otherwise
 * silently move it and record a false `starts_at` override. Only an edit
 * that actually names a date, a time or a duration recomputes.
 */
drop function public.update_event(
  uuid, text, uuid, text, timestamptz, timestamptz);

create function public.update_event(
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
-- The ACL the DROPs above destroyed.
--
-- Not optional and not inherited: a function created fresh has a null proacl
-- (EXECUTE to PUBLIC) locally, and on hosted Supabase's bootstrap grants
-- EXECUTE directly to anon, authenticated and service_role — a direct grant
-- that `revoke ... from public` does not touch. supabase/tests/database/
-- portable/grants.test.sql asserts both directions of this against whichever
-- database it is pointed at.
-- ---------------------------------------------------------------------------

revoke execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int) from public, anon;
grant execute on function public.create_event(
  uuid, text, uuid, text, date, time, int, int) to authenticated;

revoke execute on function public.update_event(
  uuid, text, uuid, text, date, time, int) from public, anon;
grant execute on function public.update_event(
  uuid, text, uuid, text, date, time, int) to authenticated;
