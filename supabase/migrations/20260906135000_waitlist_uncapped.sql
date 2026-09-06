/*
 * Task 4A: promote_waitlist and accept_promotion_offer are the last two
 * callers that still trust event_free_seats blindly. event_free_seats is
 * `greatest(0, event_capacity - confirmed - held)`, and event_capacity
 * (20260906110000) returns 0 for an open-seating event whose capacity is
 * null -- null there means UNCAPPED, not zero. So event_free_seats reports
 * 0 free seats FOREVER on an event that actually has unlimited room.
 *
 * This was unreachable when the capacity guard shipped (20260825100000),
 * because an uncapped event could never newly waitlist anyone. Task 4
 * (20260906130000) made it reachable: update_event/update_event_series can
 * now flip an event from capped to uncapped (or assigned_tables to
 * open_seating) after people are already waitlisted, stranding them
 * permanently -- promote_waitlist would promote nobody, and
 * accept_promotion_offer would clamp any outstanding offer to zero seats.
 *
 * Both bodies below are copied verbatim from their current definitions
 * (20260825090000_promote_waitlist_stops_regenerating_lapsed_offers.sql
 * and 20260825100000_accept_promotion_offer_capacity_guard.sql) with only
 * the minimal change each needs: ask public.event_is_capped(target_event)
 * once, and stop trusting event_free_seats for the answer when it says
 * "uncapped". Neither function's signature changes, so both are `create or
 * replace`, not drop-and-recreate.
 */

/*
 * CRITICAL, from the whole-branch review: an unanswered offer regenerated
 * forever and starved everyone behind it.
 *
 * sweep_promotion_offers expires an offer and calls promote_waitlist in the
 * SAME transaction. promote_waitlist's FIFO walk then reached the group
 * whose offer had just lapsed -- the `continue when exists (...
 * responded_at is null)` guard no longer matched, because the sweep had
 * just resolved that very row. The group still did not fit (free < wanted),
 * and because it was an "any table"/allow_split group, the elsif branch
 * minted a BRAND NEW offer for the same seats it had just failed to answer.
 * `event_held_seats` immediately re-counted those seats as held, `free`
 * dropped back to (or below) zero on the very next loop iteration, and
 * `exit when free <= 0` stopped the walk before it ever reached the smaller
 * group waiting behind. Reproduced against this database: capacity 2 with
 * one seat taken, a pair waitlisted and offered the one free seat, a solo
 * member waitlisted behind them. Sweep 1: open_offers 1, held 1, solo still
 * waitlisted. Sweep 2, five minutes later, with nothing else having
 * changed: identical. Forever, until the event started.
 *
 * decline_promotion_offer has the identical shape: it resolves the offer
 * (`outcome = 'declined'`) and calls promote_waitlist in the same
 * transaction, so a member who explicitly declines a partial offer could
 * be re-offered the exact same seats in the same breath.
 *
 * THE FIX, and the decision behind it (binding, not a judgment call left to
 * the implementer): a group that holds or has just lapsed an offer KEEPS
 * ITS PLACE -- waitlisted_at is never touched, exactly like the existing
 * "skipped for not fitting" rule already promises -- but the walk no
 * longer STOPS at it. Not answering (letting an offer expire) is treated
 * exactly like not fitting: the group is skipped for a NEW partial offer,
 * and the walk continues to smaller groups that fit in the seats actually
 * free. An explicit decline is treated the same way, for the same reason:
 * a member who just said no should not be handed the identical offer again
 * before the transaction that recorded their answer has even committed.
 *
 * This is a PERMANENT rule for the group, not a one-transaction guard: once
 * any of a group's own promotion_offers has resolved as 'expired' or
 * 'declined', promote_waitlist never mints another PARTIAL offer for that
 * group at this event again. The group remains fully eligible for the
 * OUTRIGHT-seating branch (free >= wanted) at any time in the future --
 * fitting completely is never refused. What stops is only the repeating
 * cycle of "offer the same partial seats, get no answer, offer them again."
 * A group that later accepts a partial offer and still has waitlisted
 * members left over (outcome = 'accepted') is NOT covered by this
 * exclusion -- confirm_group_seats already handles that continuation, and
 * it must keep receiving further offers as more seats open up.
 *
 * Termination: the FOR loop opens a cursor over booking_groups at the
 * START of the call and visits each waitlisted group AT MOST ONCE per
 * call, regardless of what confirm_group_seats or the offer insert below
 * do to other rows -- that was already true before this fix and is
 * unchanged. The new guard is a plain `not exists` on promotion_offers and
 * adds no recursion, no nested loop and no unbounded retry, so a single
 * call to promote_waitlist still does a single bounded pass. What changes
 * is only which branch a given group takes once reached, never how many
 * times it is reached.
 *
 * TASK 4A ADDITION: an uncapped event (event_is_capped = false) has
 * unlimited room by definition, so the walk must never exit on
 * `free <= 0` for one -- event_free_seats' integer contract is unchanged
 * (it still returns 0 for an uncapped event; see 20260906110000's header),
 * so it is simply never consulted for one. `capped` is read once, up
 * front, and re-read on every call (not cached across calls) so an event
 * toggled back to capped is guarded again immediately. When uncapped, the
 * outright branch (`not capped or free >= wanted`) is always taken --
 * every waitlisted group is promotable outright, so the elsif/partial-offer
 * branch below is unreachable for an uncapped event. It is still made
 * uncapped-safe (`case when capped then free else wanted end`) rather than
 * left to depend on that unreachability, since `free` itself is never
 * computed when uncapped and would otherwise be null.
 */
create or replace function public.promote_waitlist(target_event uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev        record;
  g         record;
  capped    boolean;
  free      int;
  wanted    int;
  seated    int;
  new_offer uuid;
begin
  perform 1 from public.events where id = target_event for update;

  select id, status, starts_at, club_id into ev
  from public.events where id = target_event;

  -- A cancelled or already-started game promotes nobody. Without the
  -- second test an offer could be created with expires_at in the past.
  if ev.id is null or ev.status <> 'published' or ev.starts_at <= now() then
    return;
  end if;

  -- Read once, up front -- see the TASK 4A ADDITION note above.
  capped := public.event_is_capped(target_event);

  for g in
    select * from public.booking_groups
    where event_id = target_event and status = 'waitlisted'
    order by waitlisted_at, created_at, id
  loop
    -- An uncapped event has unlimited room: event_free_seats is never
    -- consulted for one, and the walk never exits on `free <= 0`.
    if capped then
      free := public.event_free_seats(target_event);
      exit when free <= 0;
    end if;

    -- A group already holding an offer is waiting on its own answer, not
    -- on us.
    continue when exists (
      select 1 from public.promotion_offers
      where group_id = g.id and responded_at is null);

    select count(*) into wanted from public.bookings
    where group_id = g.id and status = 'waitlisted';
    continue when wanted = 0;

    if not capped or free >= wanted then
      seated := public.confirm_group_seats(g.id, wanted);
      -- 0 means allow_split is off and no single table holds them all.
      -- The group keeps its waitlisted_at, and therefore its place.
      continue when seated = 0;
    elsif (g.preferred_table_id is null or g.allow_split)
      -- Not answering is treated the same as not fitting. A group whose
      -- own offer has already resolved unfavourably (expired, unanswered;
      -- or declined, answered no) does not get a fresh partial offer --
      -- that is the exact cycle that starved the walk. It keeps its place
      -- and remains eligible for the free >= wanted branch above forever.
      and not exists (
        select 1 from public.promotion_offers
        where group_id = g.id and outcome in ('expired', 'declined'))
    then
      insert into public.promotion_offers
        (group_id, event_id, offered_seat_count, expires_at)
      values (g.id, target_event,
              case when capped then free else wanted end,
              least(now() + interval '2 hours', ev.starts_at))
      returning id into new_offer;

      insert into public.notification_outbox
        (recipient_id, club_id, event_id, kind, payload, dedupe_key)
      values (g.created_by, ev.club_id, target_event, 'promotion_offer',
              jsonb_build_object('offer_id', new_offer,
                                 'seats', case when capped then free
                                               else wanted end),
              'promotion_offer:' || new_offer::text);
    end if;
    -- else: a group that asked to stay together at a table cannot be
    -- offered part of itself, or has already had its one chance at a
    -- partial offer and did not take it. Skipped, place retained.
  end loop;
end;
$$;

-- `create or replace` preserves the ACL, but it is restated rather than
-- assumed -- the house rule after 20260822045809.
revoke execute on function public.promote_waitlist(uuid) from public, anon;
revoke execute on function public.promote_waitlist(uuid) from authenticated;

/*
 * IMPORTANT, from the whole-branch review: accept_promotion_offer could
 * seat a group past the event's capacity.
 *
 * It called `confirm_group_seats(o.group_id, o.offered_seat_count)`
 * unconditionally. confirm_group_seats itself never consults
 * event_free_seats -- when a group's own preferred_table_id is null (an
 * "any table" group, the only kind that ever holds a PARTIAL offer),
 * seat_assignments' `preferred is null` branch answers "unplaced" for
 * however many seats it is asked for and never looks at capacity at all,
 * by design (see seat_assignments' own docstring, corrected below). The
 * guard was always meant to live in the CALLER. It did, for the two
 * existing callers -- promote_waitlist only reaches this branch once it
 * has already checked `free >= wanted`, and plan_seating (the booking
 * planner) checks `event_free_seats(target_event) < n` before ever
 * calling seat_assignments. accept_promotion_offer was the third caller,
 * added without that check, and seat_assignments' own docstring
 * claimed -- wrongly -- that it already had one.
 *
 * Reproduced against this database: two tables of 2 (capacity 4), three
 * bookings confirmed, a two-person "any table" group holding an offer for
 * the event's one free seat (offered_seat_count = 1). The host then
 * removes a table (remove_event_table unseats its occupants rather than
 * cancelling them -- 20260825040000 -- so `cap 2, conf 3, held 1, free 0`
 * afterwards: the offer is still outstanding for a seat capacity no
 * longer has). The booker accepts. Before this fix: `cap 2, conf 4` --
 * one more confirmed booking than the event has room for. The offer's
 * `offered_seat_count` was correct WHEN IT WAS MINTED; nothing re-checks
 * it at the moment it is spent, and capacity can shrink in between (a
 * table removal, or -- with allow_split groups seating incrementally --
 * another accept racing in first).
 *
 * THE FIX: bound the seat count actually confirmed by the event's REAL
 * free capacity, read fresh, under the lock this function already takes,
 * at the moment of acceptance -- not by trusting the number stamped on
 * the offer when it was created. `least(o.offered_seat_count,
 * event_free_seats(o.event_id))` can only ever seat fewer than the offer
 * promised, never more; if capacity has fully evaporated it seats zero,
 * exactly like confirm_group_seats already does for any other "no seats
 * fit" case, and the group stays exactly as waitlisted as it was.
 *
 * TASK 4A ADDITION: that clamp assumed event_free_seats' integer answer
 * was always trustworthy. It is not, for an uncapped event -- see this
 * migration's header. An uncapped event has unlimited room, so the clamp
 * must yield the offer's full offered_seat_count for one; it is otherwise
 * exactly as it was, still read fresh under the same lock.
 */
create or replace function public.accept_promotion_offer(target_offer uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o      record;
  g      record;
  seated int;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not your offer' using errcode = '42501';
  end if;

  select * into o from public.promotion_offers where id = target_offer;
  if o.id is null then
    raise exception 'no such offer' using errcode = '42501';
  end if;

  select * into g from public.booking_groups where id = o.group_id;
  if g.created_by <> caller then
    raise exception 'not your offer' using errcode = '42501';
  end if;

  perform 1 from public.events where id = o.event_id for update;

  -- Re-read under the lock: the sweep may have expired it in between.
  select * into o from public.promotion_offers where id = target_offer;
  if o.responded_at is not null or o.expires_at <= now() then
    raise exception 'offer expired' using errcode = '23514';
  end if;

  -- Release the hold FIRST, so the seats this group was holding are
  -- available to itself.
  update public.promotion_offers
     set responded_at = now(), outcome = 'accepted'
   where id = o.id;

  -- Bound by capacity actually free NOW, not by the count stamped on the
  -- offer when it was minted -- see this migration's header comment.
  -- event_free_seats is read after the update above and under the event
  -- lock taken a few lines up, so it reflects the hold this offer just
  -- released and nothing this transaction has not already accounted for.
  -- An uncapped event has unlimited room, so the offer's full count is
  -- honoured rather than run through event_free_seats, which cannot
  -- report anything but 0 for one -- see this migration's header.
  seated := public.confirm_group_seats(
    o.group_id,
    case when public.event_is_capped(o.event_id)
         then least(o.offered_seat_count, public.event_free_seats(o.event_id))
         else o.offered_seat_count
    end);
  perform public.promote_waitlist(o.event_id);
  return seated;
end;
$$;

revoke execute on function public.accept_promotion_offer(uuid) from public, anon;
revoke execute on function public.accept_promotion_offer(uuid) from authenticated;
grant execute on function public.accept_promotion_offer(uuid) to authenticated;
