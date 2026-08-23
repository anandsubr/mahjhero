/*
 * Ending a booking, and moving one.
 *
 * Every function here refuses once the game has started. A seat freed
 * mid-game frees nothing, and a no-show is plan 5's concept — not a
 * cancellation with a late timestamp.
 *
 * Every function here also calls promote_waitlist before it returns.
 * That is the design: promotion happens in whichever transaction freed
 * the seat, so a member watching the screen is seated the moment their
 * friend drops out rather than up to five minutes later.
 */

create function public.close_group_if_empty(target_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.bookings
    where group_id = target_group and status in ('confirmed', 'waitlisted'))
  then
    -- A group with no live bookings must not stay 'confirmed' or
    -- 'waitlisted': promote_waitlist would keep considering a group that
    -- no longer exists.
    update public.booking_groups
       set status = 'cancelled', waitlisted_at = null
     where id = target_group and status <> 'cancelled';

    update public.promotion_offers
       set responded_at = now(), outcome = 'declined'
     where group_id = target_group and responded_at is null;
  end if;
end;
$$;

/*
 * Three callers, one body: the member, the booker who created the row, and
 * any organizer of the club. The only differences are the guard and who
 * gets told.
 */
create function public.cancel_booking(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk record;
  ev record;
begin
  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if not (bk.profile_id = auth.uid()
          or bk.booked_by = auth.uid()
          or public.is_club_organizer(bk.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  if bk.status not in ('confirmed', 'waitlisted') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
   where id = target_booking;

  -- Somebody else ended this person's booking; they are owed the news.
  if bk.profile_id <> auth.uid() then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, bk.event_id,
            'booking_cancelled_by_host',
            jsonb_build_object('booking_id', bk.id,
                               'cancelled_by', auth.uid()),
            'booking_cancelled_by_host:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

/*
 * The one-tap exit for a seat somebody else secured for you. Distinct from
 * cancellation so the booker's message can say which happened.
 */
create function public.decline_booking(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk     record;
  ev     record;
  caller uuid;
begin
  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  -- Bound and null-checked rather than compared with `<>`: a null
  -- auth.uid() makes `bk.profile_id <> auth.uid()` evaluate to NULL, so
  -- the guard would not fire and a caller with no `sub` claim could
  -- decline anybody's seat. Task 2's review caught exactly this shape in
  -- accept_promotion_offer. Every other guard in this migration is an
  -- `=`/or chain, which refuses a null caller by falling through to its
  -- `not (...)`.
  caller := auth.uid();
  if caller is null or bk.profile_id <> caller then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  -- A seat you booked yourself is cancelled, never declined. Allowing both
  -- would make the booker's outbox row a coin flip.
  if bk.booked_by = caller then
    raise exception 'nothing to decline' using errcode = '42501';
  end if;

  if bk.status not in ('confirmed', 'waitlisted') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  update public.bookings
     set status = 'declined', cancelled_at = now(), cancelled_by = caller
   where id = target_booking;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  values (bk.booked_by, bk.club_id, bk.event_id, 'booking_declined',
          jsonb_build_object('booking_id', bk.id,
                             'declined_by', bk.profile_id),
          'booking_declined:' || bk.id::text)
  on conflict (dedupe_key) do nothing;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

/*
 * "Leave the waitlist" — and equally "we are not coming after all" for a
 * seated group. The booker made the group; the booker may unmake it. An
 * organizer may too.
 */
create function public.cancel_booking_group(target_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g  record;
  ev record;
  bk record;
begin
  select * into g from public.booking_groups where id = target_group;
  if g.id is null then
    raise exception 'no such group' using errcode = '42501';
  end if;

  if not (g.created_by = auth.uid() or public.is_club_organizer(g.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select id, starts_at into ev from public.events where id = g.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = g.event_id for update;

  for bk in
    select * from public.bookings
    where group_id = target_group and status in ('confirmed', 'waitlisted')
  loop
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = auth.uid()
     where id = bk.id;

    if bk.profile_id <> auth.uid() then
      insert into public.notification_outbox
        (recipient_id, club_id, event_id, kind, payload, dedupe_key)
      values (bk.profile_id, bk.club_id, bk.event_id,
              'booking_cancelled_by_host',
              jsonb_build_object('booking_id', bk.id,
                                 'cancelled_by', auth.uid()),
              'booking_cancelled_by_host:' || bk.id::text)
      on conflict (dedupe_key) do nothing;
    end if;
  end loop;

  -- Resolves the group AND any offer holding seats for it. A held seat
  -- must never outlive the group it was held for.
  perform public.close_group_if_empty(target_group);
  perform public.promote_waitlist(g.event_id);

  return public.booking_result(target_group);
end;
$$;

/*
 * Seat an unplaced booking, move a placed one, or return one to "any
 * table" by passing null.
 *
 * A member may move their own; an organizer may move anybody's. Nobody is
 * moved silently by an algorithm — the roadmap parks automatic seating
 * under "hosts have opinions about who sits where".
 */
create function public.place_booking(target_booking uuid, target_table uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk       record;
  ev       record;
  tbl      record;
begin
  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if not (bk.profile_id = auth.uid()
          or public.is_club_organizer(bk.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  if bk.status <> 'confirmed' then
    raise exception 'booking not confirmed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
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

revoke execute on function public.close_group_if_empty(uuid) from public, anon;
revoke execute on function public.cancel_booking(uuid)       from public, anon;
revoke execute on function public.decline_booking(uuid)      from public, anon;
revoke execute on function public.cancel_booking_group(uuid) from public, anon;
revoke execute on function public.place_booking(uuid, uuid)  from public, anon;

grant execute on function public.cancel_booking(uuid)        to authenticated;
grant execute on function public.decline_booking(uuid)       to authenticated;
grant execute on function public.cancel_booking_group(uuid)  to authenticated;
grant execute on function public.place_booking(uuid, uuid)   to authenticated;
