/*
 * IMPORTANT, from the whole-branch review: end_event_series silently
 * ejected members from the games it cancelled.
 *
 * The `cancel_future` branch did a bare `update public.events set status =
 * 'cancelled' where series_id = ... and starts_at > now() and status <>
 * 'cancelled'`. Bookings on those occurrences stayed 'confirmed' or
 * 'waitlisted', their booking_groups stayed 'confirmed'/'waitlisted',
 * outstanding promotion_offers were never expired, and no `event_cancelled`
 * outbox row was written -- so nobody was told. The game then vanished from
 * "Your games" anyway, because my_upcoming_bookings filters on
 * `e.status = 'published'`, so a member with a real, unexpired seat at a
 * game the host just ended would simply stop seeing it, with no
 * notification and no record of what happened to their booking.
 *
 * cancel_event (20260825040000) already does this correctly for a single
 * event: void confirmed/waitlisted bookings, expire outstanding offers,
 * cancel the booking groups, write one event_cancelled outbox row per
 * affected member. This is the THIRD plan-3 function bookings made
 * consequential that the plan's own enumeration (`cancel_event` and
 * `remove_event_table`) missed -- end_event_series calls neither of those,
 * it sets `events.status` directly, so plan 4's own review pass never
 * looked at it.
 *
 * THE FIX reuses cancel_event itself, per occurrence, rather than copying
 * its body a fourth time -- the report for this fix names four copies of
 * one rule as how this branch got its worst bugs (BRANCH-LEVEL FINDING,
 * Task 8; the null-uid guard duplicated across cancel_booking/
 * cancel_booking_group/place_booking, Task 4). cancel_event's own guards
 * were checked before reusing it:
 *
 *   - `assert_club_organizer(owning_club)`: end_event_series already
 *     called this once, against the SAME club (an event's club_id is
 *     never different from its series' club_id -- create_event_series and
 *     materialize_event_series both stamp it from the series row). Calling
 *     it again per occurrence re-runs the same `is_club_organizer` read
 *     against the same caller and the same club; it is `stable`, takes no
 *     lock, and raises nothing a caller who already passed the first check
 *     could ever fail. Redundant, not harmful -- no double-up.
 *   - `perform 1 from public.events where id = target_event for update`:
 *     a DIFFERENT row per occurrence than the one this function's own body
 *     does not lock at all (by design -- see 20260823030000's locking
 *     note, still true here). No conflict.
 *   - cancel_event's own `no such event` guard cannot fire -- every id
 *     handed to it here came from a `select id from public.events where
 *     series_id = target_series` moments earlier, in the same statement's
 *     snapshot.
 *
 * cancel_event returns boolean and is `perform`ed, matching every other
 * call site.
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
  occ         record;
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
    for occ in
      select id from public.events
      where series_id = target_series
        and starts_at > now()
        and status <> 'cancelled'
    loop
      perform public.cancel_event(occ.id);
    end loop;
  end if;

  return true;
end;
$$;

-- `create or replace` preserves the ACL, but it is restated rather than
-- assumed -- the house rule after 20260822045809.
revoke execute on function public.end_event_series(uuid, boolean)
  from public, anon;
grant execute on function public.end_event_series(uuid, boolean)
  to authenticated;
