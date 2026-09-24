/*
 * Game invites, final-review fixes (.superpowers/sdd/final-fix-report.md):
 *
 * 1. booking_result (20260924102000) is SECURITY INVOKER but is called
 *    from several SECURITY DEFINER RPCs (accept_booking_invite,
 *    decline_booking, cancel_booking, withdraw_booking_invite,
 *    cancel_booking_group, commit_booking), so it runs with RLS bypassed
 *    and its 'placements' list could name another member's still-pending
 *    'invited' row in an invite-only game -- something bookings_select_member
 *    (20260924104000) never lets that caller read directly. An 'invited'
 *    placement is now included only when the event is open_play, the
 *    caller organizes the club, it is the caller's own row, or the caller
 *    is its booked_by (the sender watching their own invite, same rule
 *    event_seating already applies). Every other row (confirmed,
 *    waitlisted, and the caller's own 'invited' row) is unaffected. The
 *    top-level key set is unchanged (lib/schema-contract.test.ts).
 *
 * 2. accept_booking_invite's no-held-seat branch (20260924103000) moved
 *    the row into the invitee's own solo waitlisted group but left
 *    booked_by pointing at the sender. The invitee joined the queue
 *    themselves -- the sender already learned about it via
 *    booking_invite_accepted -- so booked_by becomes the caller in that
 *    same UPDATE. This is what makes a later self-cancel of that row NOT
 *    write a booking_cancelled_by_member row (cancel_booking's own
 *    `bk.booked_by <> caller` guard) and is what a "Can't make it" vs.
 *    "Leave the waitlist" style UI would key off of. The held-seat branch
 *    is untouched: the sender stays booked_by there.
 */

-- ---------------------------------------------------------------------
-- booking_result (from 20260924102000). Only the 'placements' subquery's
-- WHERE clause changes, plus the join needed to test game_mode.
-- ---------------------------------------------------------------------
create or replace function public.booking_result(target_group uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'group_id', g.id,
    'outcome', case
      when g.status = 'waitlisted' then 'waitlisted'
      when g.status = 'cancelled' then 'cancelled'
      when not exists (
             select 1 from public.bookings b
             where b.group_id = g.id
               and (b.status = 'confirmed'
                    or (b.status = 'invited' and b.invite_holds_seat)))
       and exists (
             select 1 from public.bookings b
             where b.group_id = g.id
               and b.status = 'invited' and not b.invite_holds_seat)
        then 'waitlisted'
      else 'seated' end,
    'split', (
      select count(distinct b.event_table_id) > 1
      from public.bookings b
      where b.group_id = g.id
        and (b.status = 'confirmed'
             or (b.status = 'invited' and b.invite_holds_seat))
        and b.event_table_id is not null),
    'waitlist_position', case when g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    'offer', (
      select jsonb_build_object('id', po.id, 'seats', po.offered_seat_count,
                                'expires_at', po.expires_at)
      from public.promotion_offers po
      where po.group_id = g.id and po.responded_at is null),
    'placements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', b.profile_id,
        'event_table_id', b.event_table_id,
        'table_label', t.label,
        'status', b.status) order by b.created_at, b.id)
      from public.bookings b
      left join public.event_tables t on t.id = b.event_table_id
      where b.group_id = g.id
        and b.status in ('confirmed', 'waitlisted', 'invited')
        -- Privacy: an 'invited' row is a stranger's pending answer in an
        -- invite-only game unless the caller organizes the club, it is
        -- the caller's own row, or the caller sent it. Matches
        -- bookings_select_member / event_seating (20260924104000).
        and (
          b.status <> 'invited'
          or ev.game_mode = 'open_play'
          or public.is_club_organizer(g.club_id)
          or b.profile_id = auth.uid()
          or b.booked_by = auth.uid()
        )
    ), '[]'::jsonb))
  from public.booking_groups g
  join public.events ev on ev.id = g.event_id
  where g.id = target_group;
$$;

revoke execute on function public.booking_result(uuid) from public, anon;
grant execute on function public.booking_result(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- accept_booking_invite (from 20260924103000). Only the no-held-seat
-- branch's UPDATE changes: booked_by becomes the caller (the invitee),
-- who just joined the waitlist on their own. The held-seat branch is
-- untouched -- the sender stays booked_by there, driving "<Sender> booked
-- this for you".
-- ---------------------------------------------------------------------
create or replace function public.accept_booking_invite(target_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk        record;
  ev        record;
  caller    uuid;
  new_group uuid;
begin
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if bk.profile_id <> caller then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  -- Re-read under the lock: a withdraw, a decline or the start-of-game
  -- sweep may have closed it in between.
  select * into bk from public.bookings where id = target_booking;
  if bk.status in ('confirmed', 'waitlisted') then
    raise exception 'invite already accepted' using errcode = '23514';
  end if;
  if bk.status <> 'invited' then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, status, starts_at into ev
  from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;
  if ev.status <> 'published' then
    raise exception 'event not bookable' using errcode = '23514';
  end if;

  if not public.is_club_member(bk.club_id) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  if bk.invite_holds_seat then
    update public.bookings
       set status = 'confirmed', invite_holds_seat = null
     where id = target_booking;
    new_group := bk.group_id;
  else
    insert into public.booking_groups
      (event_id, club_id, created_by, preferred_table_id, allow_split,
       status, waitlisted_at)
    values (bk.event_id, bk.club_id, caller, null, true,
            'waitlisted', now())
    returning id into new_group;

    -- booked_by becomes the invitee: they joined the queue themselves,
    -- and the sender was already notified via booking_invite_accepted.
    update public.bookings
       set group_id = new_group, status = 'waitlisted',
           invite_holds_seat = null, event_table_id = null,
           booked_by = caller
     where id = target_booking;

    perform public.close_group_if_empty(bk.group_id);
  end if;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  values (bk.booked_by, bk.club_id, bk.event_id, 'booking_invite_accepted',
          jsonb_build_object('booking_id', bk.id,
                             'accepted_by', caller,
                             'waitlisted', not bk.invite_holds_seat),
          'booking_invite_accepted:' || bk.id::text)
  on conflict (dedupe_key) do nothing;

  -- Accepting a held seat frees nothing and takes nothing new. Joining
  -- the waitlist may be answerable at once.
  if not bk.invite_holds_seat then
    perform public.promote_waitlist(bk.event_id);
  end if;

  return public.booking_result(new_group);
end;
$$;

revoke execute on function public.accept_booking_invite(uuid)
  from public, anon;
grant execute on function public.accept_booking_invite(uuid)
  to authenticated;
