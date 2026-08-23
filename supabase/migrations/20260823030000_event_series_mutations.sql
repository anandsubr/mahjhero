/*
 * Series creation, series editing, and what a club-timezone correction does
 * to events that already exist.
 *
 * The recurrence SHAPE is not editable here on purpose: frequency, weekday,
 * nth_week and starts_on have no parameters below. Changing the rhythm means
 * ending this series and starting another. Editing a rule in place requires
 * cancelling occurrences on dates the old rule produced, generating
 * occurrences on dates the new one produces, and then deciding what happens
 * to a customised week stranded on a date that exists in neither — a class of
 * bug bought for an action a club takes approximately never.
 */

/*
 * Carried in from Task 5's review — three fixes to update_event and
 * assert_venue_available, landing in this migration because it is the next
 * one to touch this function family (see the file-level comment in
 * 20260823020000 for the full ACL/locking context, which is unchanged here).
 *
 * Fix 1 + fix 2 together: update_event asserted assert_venue_available
 * unconditionally, which had a consequence nobody intended — a venue that
 * was `public` when an event booked it can later be flipped to
 * `visibility = 'club'` by its OWNING club, and every OTHER club's existing
 * events there became uneditable (verified: Riverside books Oakfield's
 * public hall, Oakfield flips it club-only, Riverside can no longer edit its
 * own event's title). The guard exists to stop you ATTACHING an unreachable
 * venue; an already-attached venue was validated when it was attached, so
 * re-checking on every edit discloses nothing new and breaks legitimate
 * edits. Fixed by only re-asserting when the venue is actually changing.
 * create_event (and create_event_series, below) keep asserting
 * unconditionally — attaching a venue for the first time always needs the
 * check.
 *
 * With that conditional in place, assert_venue_available can finally refuse
 * archived venues (`and v.archived_at is null`) — blocked before precisely
 * because unconditional re-assertion would have made editing the title of an
 * event already sitting at an archived venue impossible.
 */
create or replace function public.assert_venue_available(target_club uuid, target_venue uuid)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.venues v
    where v.id = target_venue
      and (v.added_by_club_id = target_club or v.visibility = 'public')
      and v.archived_at is null
  ) then
    raise exception 'venue not available to this club'
      using errcode = '42501';
  end if;
end;
$$;

/*
 * Fix 3: the override comparison used the untrimmed `ev.title`. The stored
 * title is only guaranteed trimmed when it was written by create_event or
 * update_event; materialize_one_series copies event_series.title verbatim,
 * and the check constraints only require length(trim(title)) > 0. With an
 * untrimmed stored title, `update_event(..., new_title => null)` computed
 * `trim(eff_title) is distinct from ev.title` as true against a title that
 * only differed by whitespace — silently retitling the row (trim(eff_title))
 * *and* recording a false 'title' override that permanently detached the
 * occurrence from future series title edits, for a change that never
 * actually happened. Fixed by trimming both sides. create_event_series below
 * trims on write, which closes this at the source for series-created rows,
 * but the comparison itself should be symmetric regardless of where the row
 * came from.
 *
 * Everything else in this function — the `for update` lock added in
 * 20260823020000, the array_append pattern, the venue/notes/starts_at
 * override checks — is unchanged from that migration.
 */
create or replace function public.update_event(
  target_event  uuid,
  new_title     text default null,
  new_venue_id  uuid default null,
  new_notes     text default null,
  new_starts_at timestamptz default null,
  new_ends_at   timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ev             public.events;
  eff_title      text;
  eff_venue      uuid;
  eff_notes      text;
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

  eff_title  := coalesce(new_title, ev.title);
  eff_venue  := coalesce(new_venue_id, ev.venue_id);
  eff_notes  := coalesce(new_notes, ev.notes);
  eff_starts := coalesce(new_starts_at, ev.starts_at);
  eff_ends   := coalesce(new_ends_at, ev.ends_at);

  -- Fix 1: only re-assert when the venue is actually changing.
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
    -- Fix 3: trim both sides. See the comment above the function.
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

/*
 * Creating a series. `create_event` keeps asserting assert_venue_available
 * unconditionally, and so does this — attaching a venue for the first time
 * always needs the check; the conditional guard above is only for editing an
 * already-attached one.
 */
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
  ends_on       date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
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

  -- Synchronously, in the same transaction, and for THIS series only. A host
  -- who creates a series and sees no games has watched the feature fail,
  -- whatever happens at 3am — and materialize_one_series lets the error
  -- propagate, so a failure rolls the creation back with it rather than
  -- leaving an empty series behind a success message. The sweep is for cron:
  -- calling it here would make one host's request materialize every club's
  -- series, and would swallow the failure of the very series being created.
  perform public.materialize_one_series(new_id);

  return new_id;
end;
$$;

/*
 * Editing the series.
 *
 * For each field this edit actually changes, propagate to every FUTURE,
 * NON-CANCELLED occurrence whose `overrides` does not contain that field.
 * Past occurrences are history and are never rewritten.
 *
 * `include_overridden` is the host's decision, surfaced in the UI as a single
 * toggle naming the affected weeks. With it on, the edit reaches the
 * customised occurrences too AND clears the edited fields from their
 * overrides — fields this edit did not touch keep theirs, so a week that
 * overrode both venue and time, edited here for time only, gets the new time
 * and keeps its venue.
 *
 * Cancelled occurrences are never touched either way. Un-cancelling a week by
 * ticking a box would be a nasty surprise for everyone who was told the game
 * was off.
 *
 * Locking: this is a classic read-modify-write shape, structurally identical
 * to update_event's (Task 5) -- se.* is read once, several eff_* values are
 * computed from that snapshot, and both event_series and events are written
 * from those computed values in later statements. Task 5 demonstrated a
 * silent lost update from exactly this shape with no lock. `for update` on
 * the initial read serializes concurrent edits to the same series, matching
 * the established pattern (accept_club_invite, 20260822044023).
 *
 * Deliberate departure from the brief: assert_venue_available is only
 * re-asserted when the venue is actually changing, for the identical reason
 * as fix 1 on update_event above -- se.venue_id was already validated when
 * it was attached (at series creation, or by a previous edit), and asserting
 * it unconditionally here would reproduce the exact bug fix 1 exists to
 * close: a foreign club flipping a public venue to club-only, or archiving
 * it, would freeze every field of every OTHER club's series still pointing
 * at it, including a plain title or notes edit that never touches the
 * venue.
 */
create function public.update_event_series(
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
  se           public.event_series;
  club_tz      text;
  eff_title    text;
  eff_venue    uuid;
  eff_notes    text;
  eff_start    time;
  eff_dur      int;
  eff_count    int;
  eff_ends     date;
  -- "The field the edit actually changes" is which PARAMETER the caller
  -- supplied, not whether the resulting value differs from what the series
  -- already had. Every other null-defaulted mutation in this schema
  -- (update_event, update_venue) already treats a non-null argument as "the
  -- caller is setting this field" regardless of whether it happens to match
  -- the current value -- a client that resubmits a whole edit form,
  -- including fields the host didn't touch on screen, still only sends
  -- non-null for the ones the form actually has inputs for. Gating
  -- propagation on `eff_x is distinct from se.x` instead breaks exactly the
  -- case this function exists for: a host uses the toggle to pull a
  -- customised week back onto the series' CURRENT venue -- new_venue_id
  -- equals se.venue_id already, nothing about the series itself changes, but
  -- the occurrence's override must still be cleared and its venue set.
  touched_title boolean := new_title is not null;
  touched_venue boolean := new_venue_id is not null;
  touched_notes boolean := new_notes is not null;
  touched_time  boolean := new_start_time is not null or new_duration is not null;
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

  -- Deliberately NOT `if touched_venue`: assert_venue_available exists to
  -- stop ATTACHING an unreachable venue. When eff_venue equals se.venue_id
  -- -- including when the caller explicitly resent the series' own current
  -- venue, as the toggle-pull-back case above does -- nothing new is being
  -- attached, and re-validating would reproduce fix 1's bug one layer up:
  -- a foreign club archiving or privatising that venue would freeze every
  -- field of this series, including edits that never touch the venue.
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

  -- Clear only the keys this edit actually touched.
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

  -- Extending it, or changing nothing, both want the horizon topped up — for
  -- this series only, for the same reasons as create_event_series above.
  perform public.materialize_one_series(target_series);

  return true;
end;
$$;

/*
 * Stopping a series. `ends_on` is set to today rather than a separate
 * "archived" flag, so there is exactly one way to express "this series is
 * over" and exactly one place materialization has to look.
 *
 * `ends_on := greatest(current_date, starts_on)`, not a bare `current_date`.
 * `event_series_ends_after_start` requires `ends_on >= starts_on`, and a
 * series whose run hasn't begun yet (`starts_on` in the future -- entirely
 * legal; nothing stops a host from ending a series before its first game)
 * would otherwise try to write an `ends_on` earlier than its own `starts_on`
 * and die on that constraint. Verified against this migration's own test
 * fixture, whose series starts 365 days out: ending it the same day it was
 * created reproduced exactly this 23514 before the fix.
 *
 * Locking: no `for update` needed, and deliberately so. The only values read
 * before writing are `owning_club` and `series_starts_on`, used solely for
 * the assert_club_organizer check and the floor above -- both are immutable
 * (no function ever updates club_id, and no function offers a starts_on
 * parameter -- see the file-level comment on why the recurrence shape is
 * fixed), so a stale read of either cannot produce a lost update. The writes
 * are safe without a lock for the same reason update_event_table's and
 * cancel_event's are (20260823020000): `ends_on` and `materialized_through`
 * are computed from values that do not change underneath a concurrent
 * caller, not from a snapshot of a column a concurrent writer could have
 * moved. The cancellation UPDATE is a plain, idempotent status flip with no
 * computed value at all.
 */
create function public.end_event_series(
  target_series uuid,
  cancel_future boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club       uuid;
  series_starts_on  date;
  new_ends_on       date;
begin
  select club_id, starts_on into owning_club, series_starts_on
  from public.event_series where id = target_series;

  if owning_club is null then
    raise exception 'no such series' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  new_ends_on := greatest(current_date, series_starts_on);

  update public.event_series
    set ends_on = new_ends_on,
        materialized_through = least(materialized_through, new_ends_on)
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

/*
 * A club correcting its timezone must not end up with new events right and
 * every existing one an hour wrong. That is the same failure the club-local
 * recurrence rule exists to prevent, arriving by a different door.
 *
 * The rule is: preserve the club-local WALL CLOCK of every future,
 * non-cancelled event. Re-resolving the same wall clock in the new zone does
 * that in one expression, and it covers one-off events too — which a
 * recompute-from-the-series-rule implementation could not, because a one-off
 * has no rule.
 *
 * Overridden occurrences are reflowed as well. A timezone change is a
 * correction of interpretation, not a schedule change: an override records
 * that this week's wall clock differs from the series', not that this week
 * is immune to being read in the right zone. This matches
 * docs/superpowers/specs/2026-08-22-events-and-scheduling-design.md's "Time,
 * timezones, and DST" section outright; two other sections of that same
 * document (Error handling, and the Testing checklist) had drifted to the
 * opposite, stale wording ("skips overridden occurrences") and are corrected
 * in this commit to stop contradicting the section that was actually right.
 *
 * security definer: `authenticated` holds `update` on `clubs.timezone`
 * (20260822033527) but no write privilege on `events` at all — every write
 * to events goes through a definer function. Without security definer here,
 * the nested UPDATE on events would fail with permission denied the moment a
 * host (not postgres) changes their club's timezone through the app.
 */
create function public.reflow_events_for_timezone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.timezone is distinct from old.timezone then
    update public.events e set
      starts_at = (e.starts_at at time zone old.timezone)
                    at time zone new.timezone,
      ends_at   = (e.ends_at at time zone old.timezone)
                    at time zone new.timezone
    where e.club_id = new.id
      and e.starts_at > now()
      and e.status <> 'cancelled';
  end if;
  return new;
end;
$$;

create trigger clubs_timezone_reflow
  after update of timezone on public.clubs
  for each row execute function public.reflow_events_for_timezone();

revoke execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint,
  time, int, int, date, date) from public, anon;
grant execute on function public.create_event_series(
  uuid, text, uuid, text, public.series_frequency, smallint, smallint,
  time, int, int, date, date) to authenticated;

revoke execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean) from public, anon;
grant execute on function public.update_event_series(
  uuid, text, uuid, text, time, int, int, date, boolean) to authenticated;

revoke execute on function public.end_event_series(uuid, boolean)
  from public, anon;
grant execute on function public.end_event_series(uuid, boolean)
  to authenticated;

-- The brief's own draft revoked this from `public, anon` only. That repeats
-- the exact mistake 20260822045809 and 20260823000000 both document and
-- fixed elsewhere in this schema: Supabase's hosted bootstrap grants EXECUTE
-- DIRECTLY to `authenticated` at function-creation time (not through
-- PUBLIC), so `revoke ... from public` alone leaves it reachable there. This
-- function is never meant to be called except by the trigger, so
-- `authenticated` is revoked explicitly too and grants.test.sql asserts the
-- negative directly against hosted rather than trusting a local `db reset`.
revoke execute on function public.reflow_events_for_timezone()
  from public, anon, authenticated;
