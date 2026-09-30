/*
 * club_games: one club's games for the club hub's Games section
 * (club-hub phase 2). Same row shape as my_games (20260929100100) plus
 * notes, and a my_status for every game ('not' when the caller has no
 * part in it). Visibility matches events_select_member: open games, plus
 * invite-only games the caller organizes or is booked on.
 */
create function public.club_games(target_club uuid, from_ts timestamptz, to_ts timestamptz)
returns table (
  event_id uuid, club_id uuid, club_name text, title text,
  game_mode public.game_mode, seating_mode public.seating_mode,
  starts_at timestamptz, ends_at timestamptz, club_timezone text, venue_name text,
  seats_taken int, capacity int, capped boolean, my_status text,
  waitlist_position int, table_label text, notes text
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_club_member(target_club) then
    raise exception 'not a member' using errcode = '42501';
  end if;

  return query
  with mine as (
    select b.event_id, b.status, b.group_id, t.label as table_label
    from public.bookings b
    left join public.event_tables t on t.id = b.event_table_id
    where b.profile_id = auth.uid()
      and b.club_id = target_club
      and b.status in ('confirmed', 'waitlisted', 'invited')
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
      when m.status = 'waitlisted' then 'waitlisted'
      when m.status = 'invited' then 'invited'
      else 'not'
    end,
    case when e.created_by <> auth.uid() and m.status = 'waitlisted' then (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    m.table_label,
    e.notes
  from public.events e
  join public.clubs c on c.id = e.club_id
  join public.venues v on v.id = e.venue_id
  left join mine m on m.event_id = e.id
  left join public.booking_groups g on g.id = m.group_id
  where e.club_id = target_club
    and e.status = 'published'
    and e.starts_at >= from_ts
    and e.starts_at < to_ts
    and (e.game_mode = 'open_play'
         or public.is_club_organizer(e.club_id)
         or public.event_has_my_active_booking(e.id))
  order by e.starts_at;
end;
$$;
revoke execute on function public.club_games(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.club_games(uuid, timestamptz, timestamptz) to authenticated;
