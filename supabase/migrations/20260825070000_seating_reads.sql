/*
 * The two reads the screens need.
 *
 * Both are `security definer` for the same reason club_roster is: since
 * 20260822180000 the `profiles` policy is SELF-ONLY, so a client joining
 * bookings to profiles gets its own name and NULL for everybody else —
 * silently, with no error. Names are published deliberately, by a function
 * whose return type is the exposure surface, and which re-asks the
 * membership question because RLS does not protect a definer function.
 *
 * event_seating returns live bookings only (confirmed and waitlisted). A
 * cancelled seat is not seating; the screens never show one.
 */

create function public.event_seating(target_event uuid)
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
  where b.event_id = target_event
    and b.status in ('confirmed', 'waitlisted')
    -- The tenant boundary. Not decoration: without it any signed-in user
    -- holding an event uuid reads that club's whole guest list.
    and public.is_club_member(b.club_id)
  order by t.position nulls last, b.created_at, b.id;
$$;

/*
 * "Your games" — across every club, which is the point. A member belongs
 * to few clubs and has few upcoming games, so there is no paging.
 */
create function public.my_upcoming_bookings()
returns table (
  booking_id       uuid,
  group_id         uuid,
  event_id         uuid,
  club_id          uuid,
  club_name        text,
  event_title      text,
  starts_at        timestamptz,
  club_timezone    text,
  venue_name       text,
  event_table_id   uuid,
  table_label      text,
  status           public.booking_status,
  booked_by        uuid,
  booked_by_name   text,
  offer_id         uuid,
  offer_seats      int,
  offer_expires_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    b.id, b.group_id, b.event_id, b.club_id, c.name, e.title, e.starts_at,
    c.timezone, v.name, b.event_table_id, t.label, b.status,
    b.booked_by, bp.display_name,
    po.id, po.offered_seat_count, po.expires_at
  from public.bookings b
  join public.events e   on e.id = b.event_id
  join public.clubs  c   on c.id = b.club_id
  join public.venues v   on v.id = e.venue_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  left join public.promotion_offers po
    on po.group_id = b.group_id and po.responded_at is null
  where b.profile_id = auth.uid()
    and b.status in ('confirmed', 'waitlisted')
    and e.status = 'published'
    and e.starts_at > now()
  order by e.starts_at, c.name;
$$;

revoke execute on function public.event_seating(uuid)      from public, anon, authenticated;
revoke execute on function public.my_upcoming_bookings()   from public, anon, authenticated;
grant  execute on function public.event_seating(uuid)      to authenticated;
grant  execute on function public.my_upcoming_bookings()   to authenticated;
