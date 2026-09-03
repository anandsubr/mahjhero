/*
 * Two more columns, same drop-and-recreate dance
 * 20260827070000_my_upcoming_bookings_check_in.sql already documents for
 * this exact function (a `returns table` function's columns are OUT
 * parameters; `create or replace` refuses to change them, 42P13).
 */
drop function if exists public.my_upcoming_bookings();

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
  offer_expires_at timestamptz,
  waitlist_position  int,
  check_in_required  boolean,
  check_in_state     public.attendance_state,
  check_in_opens_at  timestamptz,
  check_in_closes_at timestamptz,
  fee_cents          int,
  min_spend_cents    int
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
    po.id, po.offered_seat_count, po.expires_at,
    case when g.status <> 'waitlisted' then null else (
      select count(*)::int from public.booking_groups o
      where o.event_id = g.event_id and o.status = 'waitlisted'
        and (o.waitlisted_at, o.created_at, o.id)
            <= (g.waitlisted_at, g.created_at, g.id)) end,
    e.check_in_required,
    ci.state,
    case when e.check_in_required
         then e.starts_at - interval '1 hour' end,
    case when e.check_in_required then e.ends_at end,
    e.fee_cents,
    e.min_spend_cents
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
  join public.events e   on e.id = b.event_id
  join public.clubs  c   on c.id = b.club_id
  join public.venues v   on v.id = e.venue_id
  join public.profiles bp on bp.id = b.booked_by
  left join public.event_tables t on t.id = b.event_table_id
  left join public.promotion_offers po
    on po.group_id = b.group_id and po.responded_at is null
  left join public.check_ins ci
    on ci.event_id = b.event_id and ci.profile_id = b.profile_id
  where b.profile_id = auth.uid()
    and b.status in ('confirmed', 'waitlisted')
    and e.status = 'published'
    and e.ends_at > now()
  order by e.starts_at, c.name;
$$;

revoke execute on function public.my_upcoming_bookings()
  from public, anon, authenticated;
grant execute on function public.my_upcoming_bookings() to authenticated;
