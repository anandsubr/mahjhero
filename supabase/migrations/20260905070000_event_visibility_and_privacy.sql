/*
 * Invite-only games: visibility and attendee-list privacy.
 *
 * Visibility: an invite_only event is visible only to its organizer or to
 * someone who already holds an active booking on it (being booked IS being
 * invited -- see the design doc, there is no separate "invited but not
 * booked" state for an existing club member).
 *
 * Attendee-list privacy, ON TOP of visibility: for an invite_only event, a
 * non-organizer who can see the event at all still sees only their OWN
 * booking until they themselves are placed at a table -- being seated
 * unlocks the full list, not just their own table. event_accepted_count
 * gives a not-yet-placed invitee a headcount without identities.
 */

drop policy events_select_member on public.events;

create policy events_select_member on public.events
  for select using (
    public.is_club_member(club_id)
    and (status <> 'draft' or public.is_club_organizer(club_id))
    and (
      game_mode = 'open_play'
      or public.is_club_organizer(club_id)
      or exists (
        select 1 from public.bookings b
        where b.event_id = events.id
          and b.profile_id = auth.uid()
          and b.status in ('confirmed', 'waitlisted')
      )
    )
  );

create or replace function public.event_seating(target_event uuid)
returns table (
  booking_id      uuid,
  group_id        uuid,
  profile_id      uuid,
  display_name    text,
  skill_level     public.skill_level,
  event_table_id  uuid,
  status          public.booking_status,
  booked_by       uuid,
  booked_by_name  text,
  group_status    public.booking_group_status,
  waitlist_position int,
  created_at      timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  with ev as (
    select id, club_id, game_mode from public.events where id = target_event
  ),
  my_seat as (
    select b.event_table_id from public.bookings b
    where b.event_id = target_event and b.profile_id = auth.uid()
      and b.status in ('confirmed', 'waitlisted')
    limit 1
  )
  select
    b.id,
    b.group_id,
    b.profile_id,
    p.display_name,
    p.skill_level,
    b.event_table_id,
    b.status,
    b.booked_by,
    bp.display_name,
    g.status,
    case when g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    b.created_at
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
  join public.profiles p  on p.id = b.profile_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  cross join ev
  where b.event_id = target_event
    and b.status in ('confirmed', 'waitlisted')
    and public.is_club_member(ev.club_id)
    -- Visibility: same test as events_select_member's own invite_only
    -- branch, re-asked here because this function bypasses RLS entirely.
    and (
      ev.game_mode = 'open_play'
      or public.is_club_organizer(ev.club_id)
      or exists (select 1 from my_seat)
    )
    -- Attendee-list privacy: full list only once placed, for invite_only.
    and (
      ev.game_mode = 'open_play'
      or public.is_club_organizer(ev.club_id)
      or exists (select 1 from my_seat where event_table_id is not null)
      or b.profile_id = auth.uid()
    )
  order by t.position nulls last, b.created_at, b.id;
$$;

/*
 * Headcount only, no identities -- what a not-yet-placed invitee's UI shows
 * instead of a roster. Returns null rather than raising for someone who
 * cannot see the event at all, since this is a soft read the client only
 * calls once it already believes the caller has access.
 */
create function public.event_accepted_count(target_event uuid)
returns int
language sql
security definer
stable
set search_path = public
as $$
  select case when exists (
    select 1 from public.events e
    where e.id = target_event
      and public.is_club_member(e.club_id)
      and (
        e.game_mode = 'open_play'
        or public.is_club_organizer(e.club_id)
        or exists (
          select 1 from public.bookings b
          where b.event_id = target_event and b.profile_id = auth.uid()
            and b.status in ('confirmed', 'waitlisted')
        )
      )
  )
  then (
    select count(*)::int from public.bookings b
    where b.event_id = target_event and b.status in ('confirmed', 'waitlisted')
  )
  else null end;
$$;

revoke execute on function public.event_accepted_count(uuid) from public, anon;
grant  execute on function public.event_accepted_count(uuid) to authenticated;
