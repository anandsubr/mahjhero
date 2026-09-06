/*
 * Whole-branch review finding: accept_club_invite's seating attempt swallows
 * every error with `exception when others then null;` and leaves zero
 * trace. Best-effort seating (membership must never be undone by a seating
 * failure) is still the right behavior, but an unexpected failure -- as
 * opposed to the expected "event since cancelled/ended" case -- should at
 * least leave a log line so it can be noticed and investigated, rather than
 * silently vanishing.
 *
 * `create or replace`, not drop+create: signature and return type are
 * unchanged from 20260905160000, only the exception handler gains a
 * `raise warning`.
 */
create or replace function public.accept_club_invite(invite_token text)
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
      -- Still worth a trace -- an unexpected failure here (as opposed to the
      -- expected "event since cancelled/ended" no-op above) would otherwise
      -- vanish with zero signal.
      raise warning 'invite seating skipped for event %: %', invite.event_id, sqlerrm;
    end;
  end if;

  -- event_id is only meaningful to the client when seating actually
  -- happened: app/join/[token].tsx redirects to the event when this key is
  -- present/truthy, and to the plain club page otherwise. new_group is only
  -- ever set inside the nested block above, so it doubles as "did seating
  -- succeed" without needing a separate flag.
  return jsonb_build_object(
    'club_id', invite.club_id,
    'event_id', case when new_group is not null then invite.event_id else null end);
end;
$$;
