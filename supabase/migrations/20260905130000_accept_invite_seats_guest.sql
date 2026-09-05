/*
 * Return-type change (uuid -> jsonb), so this is drop+create rather than
 * create or replace. Adds: when the invite is tied to an event, attempt to
 * seat the newly-joined guest at it -- full seat if there is room,
 * waitlisted otherwise, mirroring commit_booking's own insert logic. Wrapped
 * in its own BEGIN/EXCEPTION block so a seating failure (the event was
 * since cancelled or ended, a lock contention, anything) rolls back only
 * the seating attempt via an implicit savepoint -- never the membership
 * insert above it. Seating is best-effort by design (see the plan's spec).
 *
 * Deliberately does NOT call commit_booking: commit_booking now refuses a
 * non-organizer caller on an invite_only event (Task 4), and the caller
 * here is the GUEST, never an organizer -- but this invite was already
 * organizer-authorized at CREATION time (creating an event-tied invite is
 * organizer-only, club_invites_insert_organizer), so no caller-permission
 * check belongs here at all. assert_players_bookable is still called
 * (membership + not-already-booked), since that check has nothing to do
 * with organizer status.
 */
drop function public.accept_club_invite(text);

create function public.accept_club_invite(invite_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invite     public.club_invites%rowtype;
  caller     uuid := auth.uid();
  seat_event public.events%rowtype;
  new_group  uuid;
  seating    jsonb;
  placement  jsonb;
begin
  if caller is null then
    return null;
  end if;

  select * into invite
  from public.club_invites
  where token = invite_token
  for update;

  if not found
     or invite.accepted_at is not null
     or invite.expires_at < now() then
    return null;
  end if;

  insert into public.profiles (id, display_name)
  values (caller, '')
  on conflict (id) do nothing;

  insert into public.club_members (club_id, profile_id, role)
  values (invite.club_id, caller, 'member')
  on conflict (club_id, profile_id) do update
    set status = 'active'
    where club_members.status = 'removed';

  update public.club_invites
  set accepted_at = now(), accepted_by = caller
  where id = invite.id;

  if invite.event_id is not null then
    begin
      select * into seat_event
      from public.events where id = invite.event_id for update;

      if seat_event.id is not null
         and seat_event.status = 'published'
         and seat_event.starts_at > now() then
        perform public.assert_players_bookable(
          invite.club_id, invite.event_id, array[caller]);

        seating := public.plan_seating(invite.event_id, array[caller], null, true);

        insert into public.booking_groups
          (event_id, club_id, created_by, preferred_table_id, allow_split,
           status, waitlisted_at)
        values (
          invite.event_id, invite.club_id, caller, null, true,
          case when seating->>'outcome' = 'seated'
               then 'confirmed'::public.booking_group_status
               else 'waitlisted'::public.booking_group_status end,
          case when seating->>'outcome' = 'seated' then null else now() end)
        returning id into new_group;

        if seating->>'outcome' = 'seated' then
          for placement in select * from jsonb_array_elements(seating->'placements')
          loop
            insert into public.bookings
              (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
            values (new_group, invite.event_id, invite.club_id,
                    (placement->>'event_table_id')::uuid, caller, caller);
          end loop;
        else
          insert into public.bookings
            (group_id, event_id, club_id, profile_id, booked_by, status)
          values (new_group, invite.event_id, invite.club_id, caller, caller,
                  'waitlisted');
        end if;
      end if;
    exception when others then
      -- Best-effort: membership must never be undone by a seating failure.
      null;
    end;
  end if;

  return jsonb_build_object('club_id', invite.club_id, 'event_id', invite.event_id);
end;
$$;

grant execute on function public.accept_club_invite(text) to authenticated;
