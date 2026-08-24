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

  for g in
    select * from public.booking_groups
    where event_id = target_event and status = 'waitlisted'
    order by waitlisted_at, created_at, id
  loop
    free := public.event_free_seats(target_event);
    exit when free <= 0;

    -- A group already holding an offer is waiting on its own answer, not
    -- on us.
    continue when exists (
      select 1 from public.promotion_offers
      where group_id = g.id and responded_at is null);

    select count(*) into wanted from public.bookings
    where group_id = g.id and status = 'waitlisted';
    continue when wanted = 0;

    if free >= wanted then
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
      values (g.id, target_event, free,
              least(now() + interval '2 hours', ev.starts_at))
      returning id into new_offer;

      insert into public.notification_outbox
        (recipient_id, club_id, event_id, kind, payload, dedupe_key)
      values (g.created_by, ev.club_id, target_event, 'promotion_offer',
              jsonb_build_object('offer_id', new_offer, 'seats', free),
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
