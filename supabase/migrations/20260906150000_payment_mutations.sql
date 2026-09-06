/*
 * The only writers of event_payments, and the only reader the client has.
 *
 * Both run the same ladder record_attendance established (20260827030000),
 * in this order, and the order is load-bearing:
 *
 *   1. The caller is an active member of the event's club. RLS does not
 *      protect a `security definer` function, and this must fail FIRST so
 *      that an outsider holding a guessed uuid learns nothing about whether
 *      the event exists.
 *   2. The caller is a host or co-organizer. Unlike attendance there is no
 *      self-service branch at all: a player may neither read nor write
 *      their own payment state.
 *
 * There is deliberately no `occurred_at` parameter and no newest-wins
 * clause. Attendance has one because an offline queue may replay a stale
 * tap; payment is only ever entered by an organizer standing at the door
 * with the app open, and a later mark should simply win.
 */
create function public.set_payment_status(
  target_event   uuid,
  target_profile uuid,
  is_paid        boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ev     public.events;
  caller uuid := auth.uid();
begin
  select * into ev from public.events where id = target_event;

  -- Tenancy first. `ev.id is null` is folded in here so "no such event" and
  -- "an event you cannot see" are the same answer to an outsider.
  if ev.id is null or not public.is_club_member(ev.club_id) then
    raise exception 'no such event' using errcode = '42501';
  end if;

  perform public.assert_club_organizer(ev.club_id);

  if is_paid then
    -- Roster-membership check gates this branch only. Marking someone paid
    -- asserts a fact about a person, and that person must be on the roster
    -- for the assertion to mean anything.
    if not exists (
      select 1 from public.club_members m
       where m.club_id = ev.club_id
         and m.profile_id = target_profile
         and m.status = 'active')
    then
      raise exception 'that person is not a member of this club'
        using errcode = '23514', detail = target_profile::text;
    end if;

    insert into public.event_payments
      (event_id, club_id, profile_id, paid_at, marked_by)
    values
      (target_event, ev.club_id, target_profile, now(), caller)
    on conflict (event_id, profile_id) do update
      set paid_at = now(), marked_by = caller;
  else
    -- Unmarking deliberately skips the roster check. It is a correction, not
    -- an assertion, and the person may have since left the club — the same
    -- reasoning clear_attendance already applies (20260827030000): an
    -- organizer who cannot fix a stale row stops trusting the record.
    -- Absence of a row is the unpaid state; there is no false to store.
    delete from public.event_payments
     where event_id = target_event and profile_id = target_profile;
  end if;
end;
$$;

/*
 * The door screen's read. A separate RPC rather than widening
 * event_attendance: that function is callable by any club member, and
 * bolting payment onto it would put the organizer-only column one
 * conditional away from every member's response. A separate
 * organizer-gated function keeps the leak surface to a single testable
 * place.
 */
create function public.event_payment_status(target_event uuid)
returns table (profile_id uuid, paid_at timestamptz, marked_by uuid)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  ev public.events;
begin
  select * into ev from public.events where id = target_event;

  if ev.id is null or not public.is_club_member(ev.club_id) then
    raise exception 'no such event' using errcode = '42501';
  end if;

  perform public.assert_club_organizer(ev.club_id);

  return query
    select p.profile_id, p.paid_at, p.marked_by
      from public.event_payments p
     where p.event_id = target_event;
end;
$$;

revoke execute on function public.set_payment_status(uuid, uuid, boolean)
  from public, anon;
grant execute on function public.set_payment_status(uuid, uuid, boolean)
  to authenticated;

revoke execute on function public.event_payment_status(uuid)
  from public, anon;
grant execute on function public.event_payment_status(uuid)
  to authenticated;
