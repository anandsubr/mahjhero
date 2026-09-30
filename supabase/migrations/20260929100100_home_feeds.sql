/*
 * Home feeds (club-hub redesign, phase 1).
 *
 * my_games: every game in a window that the caller has a confirmed or
 * waitlisted seat at, or created. One round trip for Home's list and
 * calendar, replacing the dashboard's per-club fetch. Invited (unanswered)
 * seats are excluded — they are shown in Home's "Needs you" until accepted.
 *
 * Both functions are security definer (RLS off), so each restates
 * events_select_member's invite-only test (20260905080000): an invite_only
 * game is visible only to the club's organizers and to people with an active
 * booking on it. Without it, my_clubs_next_game would leak the start time of
 * invite-only games a plain member cannot see, and my_games would list one a
 * demoted creator is no longer booked on.
 *
 * seats_taken counts what the capacity gate counts as occupied: confirmed
 * seats plus seat-holding invites (see event_free_seats,
 * 20260924101000_capacity_counts_held_invites.sql).
 */
create function public.my_games(from_ts timestamptz, to_ts timestamptz)
returns table (
  event_id          uuid,
  club_id           uuid,
  club_name         text,
  title             text,
  game_mode         public.game_mode,
  seating_mode      public.seating_mode,
  starts_at         timestamptz,
  ends_at           timestamptz,
  club_timezone     text,
  venue_name        text,
  seats_taken       int,
  capacity          int,
  capped            boolean,
  my_status         text,
  waitlist_position int,
  table_label       text
)
language sql
security definer
stable
set search_path = public
as $$
  with mine as (
    select b.event_id, b.status, b.group_id, t.label as table_label
    from public.bookings b
    left join public.event_tables t on t.id = b.event_table_id
    where b.profile_id = auth.uid()
      and b.status in ('confirmed', 'waitlisted')
  )
  select
    e.id, e.club_id, c.name, e.title, e.game_mode, e.seating_mode,
    e.starts_at, e.ends_at, c.timezone, v.name,
    (public.event_confirmed_seats(e.id)
      + (select count(*)::int from public.bookings ib
          where ib.event_id = e.id and ib.status = 'invited' and ib.invite_holds_seat))::int,
    public.event_capacity(e.id),
    public.event_is_capped(e.id),
    case
      when e.created_by = auth.uid() then 'hosting'
      when m.status = 'confirmed' then 'going'
      else 'waitlisted'
    end,
    case when e.created_by <> auth.uid() and m.status = 'waitlisted' then (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    m.table_label
  from public.events e
  join public.clubs c on c.id = e.club_id
  join public.venues v on v.id = e.venue_id
  left join mine m on m.event_id = e.id
  left join public.booking_groups g on g.id = m.group_id
  where e.status = 'published'
    and e.starts_at >= from_ts
    and e.starts_at < to_ts
    and (m.event_id is not null or e.created_by = auth.uid())
    and public.is_club_member(e.club_id)
    and (e.game_mode = 'open_play'
         or public.is_club_organizer(e.club_id)
         or public.event_has_my_active_booking(e.id))
  order by e.starts_at, c.name;
$$;
revoke execute on function public.my_games(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_games(timestamptz, timestamptz) to authenticated;

-- The soonest upcoming published game per club the caller belongs to, among
-- the games the caller can see (invite-only games only when an organizer or
-- booked).
create function public.my_clubs_next_game()
returns table (club_id uuid, next_starts_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select e.club_id, min(e.starts_at)
  from public.events e
  where e.status = 'published'
    and e.starts_at > now()
    and public.is_club_member(e.club_id)
    and (e.game_mode = 'open_play'
         or public.is_club_organizer(e.club_id)
         or public.event_has_my_active_booking(e.id))
  group by e.club_id;
$$;
revoke execute on function public.my_clubs_next_game() from public, anon;
grant execute on function public.my_clubs_next_game() to authenticated;
