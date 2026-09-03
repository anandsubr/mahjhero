/*
 * place_booking's freeze was stricter than the risk it protects against.
 *
 * Every successful placement calls promote_waitlist(bk.event_id) afterward
 * -- moving someone frees a table seat a waitlisted group might now fit.
 * promote_waitlist mid-game, seating someone who "left home an hour ago",
 * is the actual risk plan 4's freeze existed to prevent. But
 * promote_waitlist ALREADY refuses to run once starts_at <= now(), on its
 * own ("if ev.id is null or ev.status <> 'published' or ev.starts_at <=
 * now() then return; end if;" -- originally added in
 * 20260825010000_waitlist_promotion.sql; current/live definition in
 * 20260825090000_promote_waitlist_stops_regenerating_lapsed_offers.sql,
 * where this same guard text still holds).
 * That protection does not live in place_booking at all -- it is
 * independent of what triggers the call.
 *
 * place_booking's own starts_at guard was therefore blocking a strictly
 * safer case than the one that motivated it: filling an already-confirmed,
 * already-committed member into an open seat, with nobody waiting who
 * could be wrongly bumped in. Found live: a confirmed "any table" booking
 * on a started game, with an open seat at its only table, permanently
 * unplaceable -- by the member themselves OR by the host standing at the
 * door.
 *
 * The fix: refuse only once the game has actually ENDED, matching the same
 * "relevant until ends_at" window my_upcoming_bookings' own filter change
 * uses for the same reason (20260827070000_my_upcoming_bookings_check_in.sql:
 * `starts_at > now()` dropped a game the instant it began, when a member
 * still needs it; `ends_at > now()` keeps it around until it actually
 * finishes). cancel_booking, decline_booking,
 * and cancel_booking_group are UNTOUCHED -- giving up a seat mid-game is
 * the genuinely risky case (a seat freed with nobody present to claim it),
 * and none of this reasoning applies to it.
 */
create or replace function public.place_booking(target_booking uuid, target_table uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk       record;
  ev       record;
  tbl      record;
  caller   uuid;
begin
  -- Same null-caller hole as cancel_booking's OR-chain guard, and the same
  -- fix: bind and refuse a null caller before the OR-chain ever runs.
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if not (bk.profile_id = caller
          or public.is_club_organizer(bk.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  if bk.status <> 'confirmed' then
    raise exception 'booking not confirmed' using errcode = '23514';
  end if;

  select id, starts_at, ends_at into ev from public.events where id = bk.event_id;
  if ev.ends_at <= now() then
    raise exception 'this game has already ended' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  if target_table is not null then
    select * into tbl from public.event_tables where id = target_table;
    if tbl.id is null or tbl.event_id <> bk.event_id then
      raise exception 'no such table' using errcode = '42501';
    end if;
    -- Re-checked under the lock: the room may have gone while the screen
    -- was open.
    if public.table_free_seats(target_table) < 1
       and bk.event_table_id is distinct from target_table then
      raise exception 'table full' using errcode = '23514';
    end if;
  end if;

  update public.bookings
     set event_table_id = target_table
   where id = target_booking;

  -- Moving somebody frees no seat at the event level, but returning a
  -- booking to "any table" frees a TABLE seat, and a waiting group may fit
  -- there now.
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

revoke execute on function public.place_booking(uuid, uuid) from public, anon;
grant execute on function public.place_booking(uuid, uuid) to authenticated;
