/*
 * For an invite_only event, only the organizer may add players -- an
 * existing member's only way in is the organizer's own Invite action,
 * which is exactly this same commit_booking call made BY the organizer.
 *
 * Deliberately checks the CALLER (auth.uid()), not the players being
 * added, so this reads "who may invite" rather than "who may be invited" --
 * an organizer inviting themselves onto their own private game passes too.
 *
 * Deliberately NOT added to assert_players_bookable: accept_club_invite
 * (a later migration in this plan) seats a freshly-joined guest at a
 * private game the SAME WAY commit_booking would, but the guest is by
 * definition not an organizer -- their invite was already
 * organizer-authorized at CREATION time, so re-checking organizer status
 * at ACCEPTANCE time would wrongly refuse the very case the invite exists
 * for. accept_club_invite does its own seating insert directly rather than
 * calling commit_booking, so it never passes through this check at all.
 */
create or replace function public.propose_booking(
  target_event uuid,
  players      uuid[],
  preferred    uuid default null,
  allow_split  boolean default true
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  target_club uuid;
  mode        public.game_mode;
begin
  target_club := public.assert_event_bookable(target_event);

  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  select game_mode into mode from public.events where id = target_event;
  if mode = 'invite_only' then
    perform public.assert_club_organizer(target_club);
  end if;

  perform public.assert_players_bookable(target_club, target_event, players);

  return public.plan_seating(target_event, players, preferred, allow_split)
       || jsonb_build_object('group_id', null,
                             'waitlist_position', null,
                             'offer', null);
end;
$$;

create or replace function public.commit_booking(
  target_event uuid,
  players      uuid[],
  preferred    uuid default null,
  allow_split  boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club uuid;
  mode        public.game_mode;
  seating     jsonb;
  new_group   uuid;
  placement   jsonb;
begin
  target_club := public.assert_event_bookable(target_event);

  if not public.is_club_member(target_club) then
    raise exception 'not a member of this club' using errcode = '42501';
  end if;

  -- Everything after this line is inside the event's lock. Two members
  -- racing for the last seat serialize here, which is what makes the
  -- race impossible rather than unlikely.
  perform 1 from public.events where id = target_event for update;

  select game_mode into mode from public.events where id = target_event;
  if mode = 'invite_only' then
    perform public.assert_club_organizer(target_club);
  end if;

  perform public.assert_players_bookable(target_club, target_event, players);

  seating := public.plan_seating(target_event, players, preferred, allow_split);

  insert into public.booking_groups
    (event_id, club_id, created_by, preferred_table_id, allow_split,
     status, waitlisted_at)
  values (
    target_event, target_club, auth.uid(), preferred, allow_split,
    case when seating->>'outcome' = 'seated' then 'confirmed'::public.booking_group_status
         else 'waitlisted'::public.booking_group_status end,
    case when seating->>'outcome' = 'seated' then null else now() end)
  returning id into new_group;

  if seating->>'outcome' = 'seated' then
    for placement in select * from jsonb_array_elements(seating->'placements')
    loop
      insert into public.bookings
        (group_id, event_id, club_id, event_table_id, profile_id, booked_by)
      values (new_group, target_event, target_club,
              (placement->>'event_table_id')::uuid,
              (placement->>'profile_id')::uuid,
              auth.uid());
    end loop;
  else
    insert into public.bookings
      (group_id, event_id, club_id, profile_id, booked_by, status)
    select new_group, target_event, target_club, p, auth.uid(), 'waitlisted'
    from unnest(players) p;
  end if;

  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id, target_club, target_event, 'booked_by_friend',
         jsonb_build_object('booking_id', b.id, 'booked_by', auth.uid()),
         'booked_by_friend:' || b.id::text
  from public.bookings b
  where b.group_id = new_group and b.profile_id <> auth.uid();

  if seating->>'outcome' <> 'seated' then
    perform public.promote_waitlist(target_event);
  end if;

  return public.booking_result(new_group);
end;
$$;
