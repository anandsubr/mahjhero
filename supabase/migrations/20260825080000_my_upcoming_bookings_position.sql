/*
 * "Your games" needs to answer "should I make other plans tonight?" for a
 * waitlisted row, not just say "you're waiting." my_upcoming_bookings()
 * (20260825070000) never returned a position at all, so the client had
 * nothing to show but a generic "Waiting for a seat."
 *
 * Same signature — `my_upcoming_bookings()`, no arguments — plus one more
 * OUT column. Postgres refuses `create or replace function` for that
 * ("cannot change return type of existing function... Row type defined by
 * OUT parameters is different", 42P13): a `returns table (...)` function's
 * columns are OUT parameters, and only a strict prefix-preserving change
 * (e.g. appending nothing) is allowed in place. Found this the hard way —
 * `db reset` refused the first draft of this migration, which had assumed
 * `create or replace` alone would do it. So this drops and recreates
 * instead, which means the grant does need restating: a dropped function's
 * ACL does not survive being recreated (new object, new OID, default
 * privileges only). The net result is identical to before — only
 * `authenticated` can execute it, nothing else changed — so
 * supabase/tests/database/portable/grants.test.sql's allowlist (which
 * checks the *signature string* `public.my_upcoming_bookings()`, not a
 * specific function OID) needs no edit; it passes against the recreated
 * function the same as it did against the original. The
 * `revoke ... from public, anon, authenticated` before the grant is
 * belt-and-braces, matching 20260825070000's own pair exactly, in case a
 * future Postgres version's default privileges ever differ.
 *
 * waitlist_position is computed with the EXACT same expression
 * event_seating and booking_result both use — count of waitlisted groups
 * for this event ordered by (waitlisted_at, created_at, id), counting the
 * caller's own group inclusive of itself via `<=`. That triple is also the
 * literal `order by` promote_waitlist (20260825010000) walks when it
 * actually promotes people. Matching it here, not deriving a new ordering,
 * is the whole point: a member told "2nd" by this screen must be the same
 * member promote_waitlist would seat second.
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
  waitlist_position int
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
            <= (g.waitlisted_at, g.created_at, g.id)) end
  from public.bookings b
  join public.booking_groups g on g.id = b.group_id
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

revoke execute on function public.my_upcoming_bookings() from public, anon, authenticated;
grant  execute on function public.my_upcoming_bookings() to authenticated;
