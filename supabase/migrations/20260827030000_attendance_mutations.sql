/*
 * Recording who turned up.
 *
 * Both functions below run ONE ladder, in this order, and the order is
 * load-bearing:
 *
 *   1. The caller is an active member of the event's club. RLS does not
 *      protect a `security definer` function — the V1 spec names this as
 *      the most likely site of a tenancy bug, and plan 4's booking function
 *      is the precedent. It fails FIRST, before the event's existence,
 *      status or timing leaks anything to somebody holding a guessed uuid.
 *
 *   2. The event exists and is published. A cancelled game has no
 *      attendance to record.
 *
 *   3. check_in_required is true. If the host did not ask for check-in the
 *      feature does not exist for that game and every write is refused.
 *
 *   4. The role split, which differs between the two callers and so lives
 *      in each function rather than here.
 *
 * NOTE what is deliberately absent: any check on whether the game has
 * started. Plan 4 refuses every seat mutation once starts_at passes, and
 * this plan does the opposite on purpose — the door is exactly when
 * attendance is recorded. Check-in never moves a booking, so the reason for
 * plan 4's rule does not apply here.
 */
create function public.assert_attendance_writable(target_event uuid)
returns public.events
language plpgsql
stable
set search_path = public
as $$
declare
  ev public.events;
begin
  -- `returns public.events`, not a bare `record`: plpgsql cannot read a
  -- field off an unstructured record without a column definition list at
  -- every call site. The table's own composite type gives both callers
  -- `ev.club_id` and `ev.starts_at` for free. Same idiom as update_event's
  -- `ev public.events` (20260823070000).
  select * into ev from public.events where id = target_event;

  -- Tenancy first. `ev.id is null` is folded in here rather than checked
  -- before it, so "no such event" and "an event you cannot see" are the
  -- same answer to an outsider.
  if ev.id is null or not public.is_club_member(ev.club_id) then
    raise exception 'no such event' using errcode = '42501';
  end if;

  if ev.status <> 'published' then
    raise exception 'event not open for check-in' using errcode = '23514';
  end if;

  if not ev.check_in_required then
    raise exception 'check-in is not enabled for this event'
      using errcode = '23514';
  end if;

  return ev;
end;
$$;

revoke execute on function public.assert_attendance_writable(uuid)
  from public, anon, authenticated;

/*
 * The window, in one place.
 *
 * Opens an hour before the game so early arrivals are covered. Closes at
 * ends_at for a member and 24 hours later for an organizer, and the
 * asymmetry is the point: a member's "I'm here" is an assertion about the
 * present moment, while retroactive correction is record-keeping and that
 * is the host's job. A host who cannot fix Tuesday's list on Wednesday
 * stops believing the record.
 *
 * There is no geofencing and none is planned, so this window is the only
 * guard there is on self check-in. Accepted: the cost of a member checking
 * in from their sofa is one wrong row that the host can correct.
 */
create function public.attendance_window_open(
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_organizer boolean
)
returns boolean
language sql
immutable
as $$
  select now() >= p_starts_at - interval '1 hour'
     and now() <= case when p_organizer
                       then p_ends_at + interval '24 hours'
                       else p_ends_at end;
$$;

revoke execute on function
  public.attendance_window_open(timestamptz, timestamptz, boolean)
  from public, anon, authenticated;

create function public.record_attendance(
  target_event   uuid,
  target_profile uuid,
  new_state      public.attendance_state,
  occurred_at    timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev        public.events;
  caller    uuid := auth.uid();
  organizer boolean;
begin
  ev := public.assert_attendance_writable(target_event);
  organizer := public.is_club_organizer(ev.club_id);

  if not organizer and target_profile <> caller then
    raise exception 'you can only check yourself in' using errcode = '42501';
  end if;

  if not public.attendance_window_open(ev.starts_at, ev.ends_at, organizer)
  then
    raise exception 'check-in is not open for this event'
      using errcode = '23514';
  end if;

  -- Whoever is being recorded has to be on the roster. For an organizer
  -- this is the walk-in path's only limit: guest attendance is deferred
  -- indefinitely on the roadmap, so the picker searches members only.
  if not exists (
    select 1 from public.club_members m
     where m.club_id = ev.club_id
       and m.profile_id = target_profile
       and m.status = 'active')
  then
    raise exception 'that person is not a member of this club'
      using errcode = '23514', detail = target_profile::text;
  end if;

  -- A member checking themselves in needs a seat. Without this, anybody on
  -- the roster could mark themselves present at a game they never booked,
  -- and the walk-in path — a host observing a physical fact — becomes
  -- self-service.
  if not organizer and not exists (
    select 1 from public.bookings b
     where b.event_id = target_event
       and b.profile_id = caller
       and b.status = 'confirmed')
  then
    raise exception 'you do not have a seat at this game'
      using errcode = '23514';
  end if;

  /*
   * Newest-wins. `where excluded.recorded_at > check_ins.recorded_at` makes
   * a stale write a silent no-op rather than an error: it represents a
   * decision that has since been superseded, and reporting that as a
   * failure would be a lie. Online, occurred_at is always now() and this
   * never fires.
   */
  insert into public.check_ins
    (event_id, club_id, profile_id, state, recorded_by, recorded_at)
  values
    (target_event, ev.club_id, target_profile, new_state, caller,
     coalesce(occurred_at, now()))
  on conflict (event_id, profile_id) do update
    set state       = excluded.state,
        recorded_by = excluded.recorded_by,
        recorded_at = excluded.recorded_at
    where excluded.recorded_at > check_ins.recorded_at;
end;
$$;

create function public.clear_attendance(
  target_event   uuid,
  target_profile uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev        public.events;
  caller    uuid := auth.uid();
  organizer boolean;
begin
  -- Clearing is a write like any other: same ladder, same window, same
  -- role split. A member may only ever undo their own.
  ev := public.assert_attendance_writable(target_event);
  organizer := public.is_club_organizer(ev.club_id);

  if not organizer and target_profile <> caller then
    raise exception 'you can only clear your own check-in'
      using errcode = '42501';
  end if;

  if not public.attendance_window_open(ev.starts_at, ev.ends_at, organizer)
  then
    raise exception 'check-in is not open for this event'
      using errcode = '23514';
  end if;

  delete from public.check_ins
   where event_id = target_event and profile_id = target_profile;
end;
$$;

revoke execute on function public.record_attendance(
  uuid, uuid, public.attendance_state, timestamptz) from public, anon;
grant execute on function public.record_attendance(
  uuid, uuid, public.attendance_state, timestamptz) to authenticated;

revoke execute on function public.clear_attendance(uuid, uuid)
  from public, anon;
grant execute on function public.clear_attendance(uuid, uuid)
  to authenticated;
