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
  seated := public.confirm_group_seats(
    o.group_id,
    least(o.offered_seat_count, public.event_free_seats(o.event_id)));
  perform public.promote_waitlist(o.event_id);
  return seated;
end;
$$;

revoke execute on function public.accept_promotion_offer(uuid) from public, anon;
revoke execute on function public.accept_promotion_offer(uuid) from authenticated;
grant execute on function public.accept_promotion_offer(uuid) to authenticated;

/*
 * Corrects seat_assignments' own docstring, which asserted a guard that
 * did not exist ("every current caller already guards it ... confirm_group_
 * seats via event_free_seats before they get here"). confirm_group_seats
 * has never called event_free_seats. The function body below is otherwise
 * byte-for-byte unchanged from 20260825010000 -- this replace exists only
 * to put a true claim at the quotation site, the same discipline Task 5's
 * report names.
 */
create or replace function public.seat_assignments(
  target_event uuid,
  want         int,
  preferred    uuid,
  allow_split  boolean
)
returns table (event_table_id uuid, seats int)
language plpgsql
stable
set search_path = public
as $$
declare
  remaining int := want;
  single    uuid;
  ids       uuid[] := '{}';
  counts    int[]  := '{}';
  t         record;
  i         int;
begin
  if want is null or want <= 0 then
    return;
  end if;

  -- "Any table". Nobody is placed, by request, so allow_split has nothing
  -- to act on: a group nobody seats is trivially sitting together.
  if preferred is null then
    event_table_id := null;
    seats := want;
    return next;
    return;
  end if;

  -- Keep us together: one table has to hold all of us. Preferred first,
  -- then the rest in position order. Note this is NOT "the preferred table
  -- or nothing" — the request is togetherness, not that specific table.
  if not allow_split then
    select s.id into single from (
      select tt.id, (tt.id = preferred) as is_preferred, tt.position
      from public.event_tables tt
      where tt.event_id = target_event
        and public.table_free_seats(tt.id) >= want
      order by is_preferred desc, tt.position
    ) s limit 1;

    if single is null then
      return;
    end if;

    event_table_id := single;
    seats := want;
    return next;
    return;
  end if;

  for t in
    select tt.id, public.table_free_seats(tt.id) as room
    from public.event_tables tt
    where tt.event_id = target_event
    order by (tt.id = preferred) desc, tt.position
  loop
    exit when remaining <= 0;
    if t.room > 0 then
      ids    := ids || t.id;
      counts := counts || least(t.room, remaining);
      remaining := remaining - least(t.room, remaining);
    end if;
  end loop;

  -- Could not seat everybody. Emit nothing: a partial plan is not an
  -- answer to the question that was asked.
  if remaining > 0 then
    return;
  end if;

  for i in 1 .. coalesce(array_length(ids, 1), 0) loop
    event_table_id := ids[i];
    seats := counts[i];
    return next;
  end loop;
end;
$$;

revoke execute on function public.seat_assignments(uuid, int, uuid, boolean)
  from public, anon;
revoke execute on function public.seat_assignments(uuid, int, uuid, boolean)
  from authenticated;

/*
 * confirm_group_seats' own docstring already correctly stated that IT does
 * not decide placement ("The caller does not decide placement; seat_
 * assignments does") and never claimed a capacity guard of its own, so it
 * needs no correction -- only its own comment header gains one sentence
 * making explicit what was previously only implied: it does not check
 * event-level capacity either. The body is otherwise byte-for-byte
 * unchanged from 20260825010000.
 */
create or replace function public.confirm_group_seats(target_group uuid, want int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  g       record;
  a       record;
  b       record;
  taken   int := 0;
  filled  int;
begin
  select * into g from public.booking_groups where id = target_group;
  if g.id is null then
    return 0;
  end if;

  -- Takes the event lock before reading any seat count, per the
  -- concurrency design (see promote_waitlist). A no-op when the caller
  -- already holds it in this transaction.
  --
  -- This function does NOT check event-level capacity itself -- see
  -- seat_assignments' docstring above. `want` is trusted as already
  -- bounded by the caller (promote_waitlist's `free >= wanted` branch,
  -- accept_promotion_offer's `least(..., event_free_seats(...))` as of
  -- 20260825100000). A future caller that skips this is not protected by
  -- anything in here.
  perform 1 from public.events where id = g.event_id for update;

  for a in
    select * from public.seat_assignments(
      g.event_id, want, g.preferred_table_id, g.allow_split)
  loop
    filled := 0;
    for b in
      select bk.id from public.bookings bk
      where bk.group_id = target_group and bk.status = 'waitlisted'
      order by (bk.profile_id = g.created_by) desc, bk.created_at, bk.id
      limit a.seats
    loop
      update public.bookings
         set status = 'confirmed', event_table_id = a.event_table_id
       where id = b.id;
      filled := filled + 1;
      taken  := taken + 1;
    end loop;
    exit when filled = 0;
  end loop;

  if taken = 0 then
    return 0;
  end if;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select bk.profile_id, g.club_id, g.event_id, 'waitlist_promoted',
         jsonb_build_object('booking_id', bk.id,
                            'event_table_id', bk.event_table_id),
         'waitlist_promoted:' || bk.id::text
  from public.bookings bk
  where bk.group_id = target_group and bk.status = 'confirmed'
  on conflict (dedupe_key) do nothing;

  -- A group with nobody left in the queue is no longer a waiting group.
  if not exists (
    select 1 from public.bookings
    where group_id = target_group and status = 'waitlisted')
  then
    update public.booking_groups
       set status = 'confirmed', waitlisted_at = null
     where id = target_group;
  end if;

  return taken;
end;
$$;

revoke execute on function public.confirm_group_seats(uuid, int)
  from public, anon;
revoke execute on function public.confirm_group_seats(uuid, int)
  from authenticated;
