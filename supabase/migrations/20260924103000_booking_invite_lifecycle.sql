/*
 * Game invites, lifecycle: answering, withdrawing, leaving, and the game
 * ending or starting around a pending invite
 * (docs/superpowers/specs/2026-09-24-game-invites-accept-decline-design.md).
 *
 * New: accept_booking_invite, withdraw_booking_invite (client RPCs) and
 * close_started_invites (scheduled sweep, 20260924103200).
 * Changed: cancel_booking, decline_booking, cancel_booking_group,
 * cancel_event -- each copied verbatim from its latest definition
 * (20260825030000 for the first three, 20260825040000 for cancel_event)
 * with only the invite change applied.
 *
 * Every exit from 'invited' sets invite_holds_seat = null in the same
 * UPDATE (20260924100100's check constraint) and clears the table, except
 * accepting a held seat, which keeps it. accept, decline and withdraw race
 * on the same row, so each re-reads it after taking the event lock.
 *
 * ACLs restated per the house rule: client RPCs revoke public, anon and
 * grant authenticated; close_started_invites is revoked from everyone but
 * its owner.
 */

-- ---------------------------------------------------------------------
-- cancel_booking (from 20260825030000). Still refuses an invited row
-- ('booking already closed' -- withdraw_booking_invite is that path).
-- New: the member leaving a seat somebody else booked for them tells the
-- booker. A host removing someone still tells the member, unchanged.
-- ---------------------------------------------------------------------
create or replace function public.cancel_booking(target_booking uuid)
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
  -- Bound and null-checked before anything else: with an OR-chain guard
  -- (`bk.profile_id = auth.uid() or ... or is_club_organizer(...)`), a
  -- session with no `sub` claim makes every `= auth.uid()` term NULL and
  -- is_club_organizer(...) a definite false, so `NULL or NULL or false` is
  -- NULL, `not NULL` is NULL, and plpgsql skips an `if` whose condition is
  -- NULL — the guard never fires. Binding `caller` and refusing a null
  -- caller up front, as decline_booking already does, closes that hole.
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into bk from public.bookings where id = target_booking;
  if bk.id is null then
    raise exception 'no such booking' using errcode = '42501';
  end if;

  if not (bk.profile_id = caller
          or bk.booked_by = caller
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
     set status = 'cancelled', cancelled_at = now(), cancelled_by = caller
   where id = target_booking;

  -- Somebody else ended this person's booking; they are owed the news.
  if bk.profile_id <> caller then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, bk.event_id,
            'booking_cancelled_by_host',
            jsonb_build_object('booking_id', bk.id,
                               'cancelled_by', caller),
            'booking_cancelled_by_host:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  -- The member walked away from a seat somebody else secured for them
  -- (an accepted invite). The sender is owed the news: the seat is open
  -- again, and they may want to invite someone else into it. A member
  -- leaving a seat they booked themselves tells nobody.
  if bk.profile_id = caller and bk.booked_by <> caller then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.booked_by, bk.club_id, bk.event_id,
            'booking_cancelled_by_member',
            jsonb_build_object('booking_id', bk.id,
                               'cancelled_by', caller),
            'booking_cancelled_by_member:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

revoke execute on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- decline_booking (from 20260825030000). Now also takes an 'invited' row
-- (the invitee saying no). A declined invite gives up its hold and its
-- table. The status is re-read under the event lock: accept and decline
-- of the same invite can race, and the loser must be refused rather than
-- overwrite the winner.
-- ---------------------------------------------------------------------
create or replace function public.decline_booking(target_booking uuid)
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
  -- decline anybody's seat.
  caller := auth.uid();
  if caller is null or bk.profile_id <> caller then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  -- A seat you booked yourself is cancelled, never declined. Allowing both
  -- would make the booker's outbox row a coin flip.
  if bk.booked_by = caller then
    raise exception 'nothing to decline' using errcode = '42501';
  end if;

  if bk.status not in ('confirmed', 'waitlisted', 'invited') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  -- Re-read under the lock.
  select * into bk from public.bookings where id = target_booking;
  if bk.status not in ('confirmed', 'waitlisted', 'invited') then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  update public.bookings
     set status = 'declined', cancelled_at = now(), cancelled_by = caller,
         invite_holds_seat = null,
         event_table_id = case when bk.status = 'invited' then null
                               else event_table_id end
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

revoke execute on function public.decline_booking(uuid) from public, anon;
grant execute on function public.decline_booking(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- cancel_booking_group (from 20260825030000). "We are not coming after
-- all" ends the group's pending invites too -- the group's creator is the
-- invites' sender, who could withdraw each one anyway. An invitee is told
-- their invite was withdrawn, not that a host cancelled a seat they never
-- had.
-- ---------------------------------------------------------------------
create or replace function public.cancel_booking_group(target_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g      record;
  ev     record;
  bk     record;
  caller uuid;
begin
  -- Same null-caller hole as cancel_booking's OR-chain guard, and the same
  -- fix: bind and refuse a null caller before the OR-chain ever runs.
  caller := auth.uid();
  if caller is null then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select * into g from public.booking_groups where id = target_group;
  if g.id is null then
    raise exception 'no such group' using errcode = '42501';
  end if;

  if not (g.created_by = caller or public.is_club_organizer(g.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  select id, starts_at into ev from public.events where id = g.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  perform 1 from public.events where id = g.event_id for update;

  for bk in
    select * from public.bookings
    where group_id = target_group
      and status in ('confirmed', 'waitlisted', 'invited')
  loop
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = caller,
           invite_holds_seat = null,
           event_table_id = case when bk.status = 'invited' then null
                                 else event_table_id end
     where id = bk.id;

    if bk.profile_id <> caller then
      if bk.status = 'invited' then
        insert into public.notification_outbox
          (recipient_id, club_id, event_id, kind, payload, dedupe_key)
        values (bk.profile_id, bk.club_id, bk.event_id,
                'booking_invite_withdrawn',
                jsonb_build_object('booking_id', bk.id,
                                   'cancelled_by', caller),
                'booking_invite_withdrawn:' || bk.id::text)
        on conflict (dedupe_key) do nothing;
      else
        insert into public.notification_outbox
          (recipient_id, club_id, event_id, kind, payload, dedupe_key)
        values (bk.profile_id, bk.club_id, bk.event_id,
                'booking_cancelled_by_host',
                jsonb_build_object('booking_id', bk.id,
                                   'cancelled_by', caller),
                'booking_cancelled_by_host:' || bk.id::text)
        on conflict (dedupe_key) do nothing;
      end if;
    end if;
  end loop;

  -- Resolves the group AND any offer holding seats for it. A held seat
  -- must never outlive the group it was held for.
  perform public.close_group_if_empty(target_group);
  perform public.promote_waitlist(g.event_id);

  return public.booking_result(target_group);
end;
$$;

revoke execute on function public.cancel_booking_group(uuid) from public, anon;
grant execute on function public.cancel_booking_group(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- accept_booking_invite (new). Invitee only; invited row; game not
-- started. Organizer status is NOT re-checked for an invite-only game --
-- the invite was organizer-authorized when sent (same reasoning as guest
-- invites, 20260905090000). Club membership IS checked: nothing cancels a
-- removed member's pending invite, and accepting must not seat a
-- non-member.
--
--   holds a seat -> 'confirmed', keeping its table (or its "any table").
--   holds none   -> moved into a NEW solo waitlisted group (created_by the
--                   invitee, any table, waitlisted_at = now()), i.e. the
--                   back of the queue as of accepting; the sender's group
--                   is closed if that was its last live row, and the queue
--                   is walked so a seat that has come free since is used.
-- ---------------------------------------------------------------------
create function public.accept_booking_invite(target_booking uuid)
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

    update public.bookings
       set group_id = new_group, status = 'waitlisted',
           invite_holds_seat = null, event_table_id = null
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

-- ---------------------------------------------------------------------
-- withdraw_booking_invite (new). The sender (booked_by) or any organizer
-- of the club; invited row; game not started. -> cancelled, the hold and
-- its table released, the invitee told, the group closed if that was its
-- last live row, and the queue walked for the freed seat.
-- ---------------------------------------------------------------------
create function public.withdraw_booking_invite(target_booking uuid)
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

  if not (bk.booked_by = caller
          or public.is_club_organizer(bk.club_id)) then
    raise exception 'not your booking' using errcode = '42501';
  end if;

  perform 1 from public.events where id = bk.event_id for update;

  -- Re-read under the lock: the invitee may have answered in between.
  select * into bk from public.bookings where id = target_booking;
  if bk.status in ('confirmed', 'waitlisted') then
    raise exception 'invite already accepted' using errcode = '23514';
  end if;
  if bk.status <> 'invited' then
    raise exception 'booking already closed' using errcode = '23514';
  end if;

  select id, starts_at into ev from public.events where id = bk.event_id;
  if ev.starts_at <= now() then
    raise exception 'event already started' using errcode = '23514';
  end if;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), cancelled_by = caller,
         invite_holds_seat = null, event_table_id = null
   where id = target_booking;

  if bk.profile_id <> caller then
    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, bk.event_id,
            'booking_invite_withdrawn',
            jsonb_build_object('booking_id', bk.id,
                               'cancelled_by', caller),
            'booking_invite_withdrawn:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end if;

  perform public.close_group_if_empty(bk.group_id);
  perform public.promote_waitlist(bk.event_id);

  return public.booking_result(bk.group_id);
end;
$$;

revoke execute on function public.withdraw_booking_invite(uuid)
  from public, anon;
grant execute on function public.withdraw_booking_invite(uuid)
  to authenticated;

-- ---------------------------------------------------------------------
-- close_started_invites (new, scheduled). An invite still pending when
-- its game starts is closed as 'cancelled', silently (spec: "Game starts
-- with pending invites -- none"). accept/decline/withdraw already refuse
-- once starts_at passes, so the few minutes before this runs change no
-- outcome; this only stops a dead invite holding a seat in the reads.
-- cancelled_by stays null: nobody did it. Per-event lock, same order as
-- every other writer. No promote_waitlist: a started game promotes nobody.
-- ---------------------------------------------------------------------
create function public.close_started_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev record;
  g  record;
begin
  for ev in
    select distinct b.event_id
    from public.bookings b
    join public.events e on e.id = b.event_id
    where b.status = 'invited' and e.starts_at <= now()
    order by b.event_id
  loop
    perform 1 from public.events where id = ev.event_id for update;

    -- Re-check starts_at after taking the lock: another writer could have
    -- changed it (a series shift, say) between the scan above and the lock
    -- being granted, and a game that is no longer started must be skipped.
    for g in
      update public.bookings
         set status = 'cancelled', cancelled_at = now(),
             invite_holds_seat = null, event_table_id = null
       where event_id = ev.event_id and status = 'invited'
         and exists (
           select 1 from public.events
           where id = ev.event_id and starts_at <= now())
      returning group_id
    loop
      perform public.close_group_if_empty(g.group_id);
    end loop;
  end loop;
end;
$$;

-- Maintenance across every event in the system, called only by the
-- schedule (as postgres). Revoked from authenticated explicitly -- the
-- hosted-bootstrap direct grant that 20260825060000 and 20260825061000
-- describe.
revoke execute on function public.close_started_invites()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- cancel_event (from 20260825040000). Pending invites are closed with
-- everything else, and their invitees get the same event_cancelled row:
-- they were told about this game, so they are told it is off.
-- (end_event_series reaches this per occurrence and needs no change.)
-- ---------------------------------------------------------------------
create or replace function public.cancel_event(target_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  owning_club uuid;
  bk          record;
begin
  select club_id into owning_club from public.events where id = target_event;

  if owning_club is null then
    raise exception 'no such event' using errcode = 'P0002';
  end if;
  perform public.assert_club_organizer(owning_club);

  perform 1 from public.events where id = target_event for update;

  update public.events set status = 'cancelled' where id = target_event;

  for bk in
    select * from public.bookings
    where event_id = target_event
      and status in ('confirmed', 'waitlisted', 'invited')
  loop
    update public.bookings
       set status = 'cancelled', cancelled_at = now(),
           cancelled_by = auth.uid(),
           invite_holds_seat = null,
           event_table_id = case when bk.status = 'invited' then null
                                 else event_table_id end
     where id = bk.id;

    insert into public.notification_outbox
      (recipient_id, club_id, event_id, kind, payload, dedupe_key)
    values (bk.profile_id, bk.club_id, target_event, 'event_cancelled',
            jsonb_build_object('booking_id', bk.id),
            'event_cancelled:' || bk.id::text)
    on conflict (dedupe_key) do nothing;
  end loop;

  update public.promotion_offers
     set responded_at = now(), outcome = 'expired'
   where event_id = target_event and responded_at is null;

  update public.booking_groups
     set status = 'cancelled', waitlisted_at = null
   where event_id = target_event and status <> 'cancelled';

  -- No promote_waitlist call: a cancelled game has nobody to promote, and
  -- promote_waitlist returns immediately on a non-published event anyway.
  return true;
end;
$$;

revoke execute on function public.cancel_event(uuid) from public, anon;
grant execute on function public.cancel_event(uuid) to authenticated;
