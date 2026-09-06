/*
 * Two security-definer predicates that break a cross-table RLS recursion:
 * events_select_member (Task 2) queries bookings, and this file's own
 * bookings_select_member needs to query events. Combined, that is a real
 * cycle -- evaluating either policy under RLS would require evaluating the
 * other -- which Postgres refuses outright ("infinite recursion detected
 * in policy for relation bookings"). Every other cross-table RLS question
 * in this schema already avoids this the same way (is_club_member,
 * is_club_organizer, is_booking_group_member): a security-definer function
 * runs as its owner and bypasses RLS on the tables it reads, so routing
 * through one severs the cycle at that link. Both directions of this new
 * cycle go through a function rather than a raw subquery, so neither a
 * cross-table nor a same-table self-reference remains ambiguous.
 *
 * Plain boolean predicates like these, and like is_club_member/
 * is_club_organizer before them, are harmless to expose broadly (they leak
 * nothing beyond a yes/no this caller could otherwise derive), but this
 * project is explicit rather than relying on Postgres's default grant to
 * PUBLIC -- see the grant statements below.
 */
create function public.event_has_my_active_booking(target_event uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where event_id = target_event
      and profile_id = auth.uid()
      and status in ('confirmed', 'waitlisted')
  );
$$;

create function public.event_has_my_placed_seat(target_event uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.bookings
    where event_id = target_event
      and profile_id = auth.uid()
      and event_table_id is not null
      and status in ('confirmed', 'waitlisted')
  );
$$;

revoke execute on function public.event_has_my_active_booking(uuid) from public, anon;
revoke execute on function public.event_has_my_placed_seat(uuid) from public, anon;
grant execute on function public.event_has_my_active_booking(uuid) to authenticated;
grant execute on function public.event_has_my_placed_seat(uuid) to authenticated;

/*
 * A second drop+recreate of Task 2's events_select_member -- not an edit to
 * Task 2's already-applied migration file, which stays untouched, per this
 * project's forward-only migration rule. Identical to Task 2's version
 * except the raw `exists (select 1 from public.bookings b where ...)` is
 * replaced with the definer-function call above.
 */
drop policy events_select_member on public.events;

create policy events_select_member on public.events
  for select using (
    public.is_club_member(club_id)
    and (status <> 'draft' or public.is_club_organizer(club_id))
    and (
      game_mode = 'open_play'
      or public.is_club_organizer(club_id)
      or public.event_has_my_active_booking(id)
    )
  );

/*
 * The bookings-table policy itself. Safe to reference `events` directly in
 * a subquery: events_select_member no longer references bookings under RLS
 * (it goes through event_has_my_active_booking instead), so this is a
 * one-directional dependency, not a cycle.
 */
drop policy bookings_select_member on public.bookings;

create policy bookings_select_member on public.bookings
  for select using (
    public.is_club_member(club_id)
    and (
      exists (
        select 1 from public.events e
        where e.id = bookings.event_id and e.game_mode = 'open_play'
      )
      or public.is_club_organizer(club_id)
      or profile_id = auth.uid()
      or public.event_has_my_placed_seat(bookings.event_id)
    )
  );
