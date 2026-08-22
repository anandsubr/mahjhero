/*
 * Fix pass on 20260823010000's event and table mutations, from code review.
 *
 * Migrations are forward-only, so every fix here is a CREATE OR REPLACE
 * FUNCTION with the exact same name, argument names and defaults as before --
 * PostgREST resolves RPC calls by argument name, so none of that is
 * negotiable. Nothing about the tenancy guards (assert_club_organizer /
 * assert_venue_available) changes; they were reviewed separately and found
 * sound.
 */

/*
 * update_event was a read-modify-write with no row lock. Two concurrent
 * calls -- S1 sets title, S2 (reading after S1 but committing after) sets
 * only notes -- both read the same pre-image, each compute their own
 * next_overrides from that snapshot, and whichever UPDATE commits second
 * overwrites the first's committed column *and* silently drops its override
 * key, with no error to either caller. Reproduced against the linked
 * project with two concurrent psql sessions; see the fix-pass report.
 *
 * The fix is `for update` on the initial read, the same shape already used
 * for exactly this reason in accept_club_invite (20260822044023) and
 * reactivate_removed_club_member (20260822045445): lock the row before
 * reading it, so a second concurrent caller blocks on the first and then
 * reads the post-update row rather than a stale one.
 *
 * A second, independent bug lived in the same function: the override
 * comparison used the untrimmed `eff_title` while the write used
 * `trim(eff_title)`. A whitespace-padded but otherwise unchanged title
 * (`'  Weekly  '` against a stored `'Weekly'`) compared unequal and so
 * registered a false 'title' override, permanently detaching that
 * occurrence from the series title for a change that never actually
 * happened. Fixed by comparing the trimmed value, matching what actually
 * gets written. `notes` is not trimmed on write, so its comparison was
 * already consistent and is untouched.
 *
 * Per-function conclusion on the lock, covering every function in
 * 20260823010000 that reads a row before writing:
 *
 *   - update_event: needed it, added above. It computes several fields from
 *     a snapshot read in one statement and writes them, unconditionally, in
 *     a later statement -- the textbook lost-update shape.
 *   - cancel_event: does not need it. Its UPDATE sets status to the literal
 *     'cancelled', not to a value computed from the earlier SELECT (which
 *     exists only to find owning_club for the guard). Concurrent cancels
 *     are idempotent. Left unchanged.
 *   - update_event_table: does not need it. label/skill_tier are computed
 *     *inside* the UPDATE's own SET clause (`coalesce(new_label, label)`),
 *     not from a separately-read snapshot -- a single UPDATE statement
 *     naturally reads the current row under its own row lock, waits out any
 *     concurrent writer, and reevaluates against the post-write row. Only
 *     gained a status check for the cancelled-event guard below, not a lock.
 *   - remove_event_table: needed a lock, but a different one. Its race is
 *     not a lost update on a single row -- it is two concurrent removes
 *     both observing "count = 2, so this delete is safe" against the same
 *     event, both proceeding, and the event ending up with zero tables.
 *     Fixed by locking every table row for the event before counting them
 *     (`for update` in the counting CTE below), so the second remover
 *     blocks on the first and recounts against the post-delete state.
 *   - add_event_table: read-then-insert over a set (`max(position)+1`), a
 *     different race again from update_event's. Two concurrent adds can
 *     compute the same next_pos, but (event_id, position) already has a
 *     unique constraint (20260822194000), so the loser gets a 23505 and can
 *     retry rather than silently colliding or losing data. That failure
 *     mode is acceptable for an already-rare race, so this function is left
 *     without an explicit row lock -- see the comment inline below.
 *   - create_event: pure insert, nothing to read-modify-write. N/A.
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
  -- Cancelling is a different kind of statement from customising, and
  -- un-cancelling by editing would be a nasty surprise for everyone who was
  -- told the game was off.
  if ev.status = 'cancelled' then
    raise exception 'a cancelled event cannot be edited'
      using errcode = '42501';
  end if;

  eff_title  := coalesce(new_title, ev.title);
  eff_venue  := coalesce(new_venue_id, ev.venue_id);
  eff_notes  := coalesce(new_notes, ev.notes);
  eff_starts := coalesce(new_starts_at, ev.starts_at);
  eff_ends   := coalesce(new_ends_at, ev.ends_at);

  perform public.assert_venue_available(ev.club_id, eff_venue);

  if length(trim(eff_title)) = 0 then
    raise exception 'title is required' using errcode = '23514';
  end if;
  if eff_ends <= eff_starts then
    raise exception 'an event must end after it starts' using errcode = '23514';
  end if;

  next_overrides := ev.overrides;

  if ev.series_id is not null then
    -- array_append, not `next_overrides || 'title'`: with a plain-text
    -- literal on the right, `||` resolves to the anyarray-concatenation
    -- overload rather than anyarray-append, and tries to parse 'title' as
    -- an array literal -- "malformed array literal: title" (22P02),
    -- confirmed against the live database. array_append forces the
    -- unambiguous element-append overload.
    --
    -- Compared trimmed against ev.title: the column is always stored
    -- trimmed (see the UPDATE below), so a whitespace-padded title that is
    -- otherwise unchanged must compare equal here too, or it silently
    -- gains a permanent override for a change that never happened.
    if trim(eff_title) is distinct from ev.title then
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

    -- Editing the same field twice must not stack the key. The FROM clause
    -- reads next_overrides's current value in full before the INTO target
    -- is assigned, so this is a plain read-then-replace, not a mutation
    -- feeding on itself.
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
 * MINOR 4: cancelling an event refuses further edits to it (update_event,
 * above), but the three table functions did not -- add_event_table on a
 * cancelled event used to succeed. Made consistent: a cancelled event's
 * seating is now frozen exactly like its details. Plan 4 attaches bookings
 * to event_tables.id, so editable seating on a cancelled event would only
 * get more confusing later.
 *
 * MINOR 1: the cap was on `position`, not on how many tables the event
 * actually holds. An event that ever reached 20 tables could never add
 * another, even after a removal freed a slot. Fixed by capping on row
 * count; positions are left free to go sparse, which is fine --
 * max(position)+1 is always strictly greater than every existing position,
 * so it can never collide with (event_id, position)'s unique constraint.
 */
create or replace function public.add_event_table(target_event uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club  uuid;
  event_status public.event_status;
  next_pos     int;
  live_count   int;
  new_id       uuid;
begin
  select club_id, status into owning_club, event_status
  from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  if event_status = 'cancelled' then
    raise exception 'a cancelled event''s tables cannot be edited'
      using errcode = '42501';
  end if;

  -- Read-then-insert over a *set* (max(position), count(*)), not a
  -- single-row read-modify-write -- a different race from update_event's.
  -- Two concurrent adds can compute the same next_pos, but (event_id,
  -- position) is already unique (20260822194000), so the loser gets a
  -- 23505 and can retry instead of silently colliding or losing data. That
  -- is an acceptable failure mode for an already-rare race, so this
  -- function is deliberately left without an explicit row lock.
  select coalesce(max(position), 0) + 1, count(*)
  into next_pos, live_count
  from public.event_tables where event_id = target_event;

  if live_count >= 20 then
    raise exception 'too many tables' using errcode = '23514';
  end if;

  insert into public.event_tables (event_id, club_id, label, position)
  values (target_event, owning_club, 'Table ' || next_pos, next_pos)
  returning id into new_id;

  return new_id;
end;
$$;

-- MINOR 4, see above.
create or replace function public.update_event_table(
  target_table uuid,
  new_label    text default null,
  new_tier     public.skill_tier default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club  uuid;
  event_status public.event_status;
begin
  select t.club_id, e.status
  into owning_club, event_status
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  if event_status = 'cancelled' then
    raise exception 'a cancelled event''s tables cannot be edited'
      using errcode = '42501';
  end if;

  -- label/skill_tier are computed inside this UPDATE's own SET clause from
  -- the row it is about to write, not from a value read in an earlier
  -- statement -- a single UPDATE naturally locks the row, waits out any
  -- concurrent writer, and reevaluates against the post-write row. No
  -- separate `for update` needed.
  update public.event_tables set
    label      = coalesce(nullif(trim(coalesce(new_label, '')), ''), label),
    skill_tier = coalesce(new_tier, skill_tier)
  where id = target_table;

  return true;
end;
$$;

-- MINOR 4, see above. Also closes remove_event_table's own race: two
-- concurrent removes on an event with exactly two tables could both read
-- "2 remain" before either deleted, both pass the "keep at least one"
-- check, and both proceed -- leaving zero. Locking every table row for the
-- event before counting them serializes concurrent removers: the second
-- blocks on the first's row locks and recounts against the post-delete
-- state once they're released.
create or replace function public.remove_event_table(target_table uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club  uuid;
  owning_event uuid;
  event_status public.event_status;
  remaining    int;
begin
  select t.club_id, t.event_id, e.status
  into owning_club, owning_event, event_status
  from public.event_tables t
  join public.events e on e.id = t.event_id
  where t.id = target_table;

  if owning_club is null then
    raise exception 'no such table' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  if event_status = 'cancelled' then
    raise exception 'a cancelled event''s tables cannot be edited'
      using errcode = '42501';
  end if;

  with locked as (
    select id from public.event_tables
    where event_id = owning_event
    for update
  )
  select count(*) into remaining from locked;

  if remaining <= 1 then
    raise exception 'an event must keep at least one table'
      using errcode = '23514';
  end if;

  delete from public.event_tables where id = target_table;
  return true;
end;
$$;

/*
 * MINOR 8: assert_club_organizer (20260822192000_create_venues.sql) was
 * only ever revoked from `public, anon`, never from `authenticated`.
 * Locally that reads as harmless -- the local stack grants nothing to
 * authenticated by default, which is exactly why it slipped through -- but
 * Supabase's hosted bootstrap grants EXECUTE directly to authenticated at
 * function-creation time, and `revoke ... from public` never touches a
 * direct grant. It is a read-only assertion helper, so the practical impact
 * is nil, but an ACL that does not say what it means is the trap this
 * project keeps hitting (20260822045809, and assert_venue_available's own
 * comment above it in 20260823010000).
 */
revoke execute on function public.assert_club_organizer(uuid) from authenticated;
