/*
 * Whole-branch review finding: booking_groups and table_rounds were never
 * brought into the invite-only privacy model. Task 3's bookings_privacy
 * migration (20260905080000) rewrote bookings_select_member and
 * events_select_member with the three-way branch below, but no task's file
 * list covered these other two tables that carry the same kind of
 * information (who is coming, what happened at the table) -- their
 * `_select_member` policies still used the pre-feature `is_club_member(club_id)`
 * alone, so any club member could read a private event's attendance and
 * match results even though they cannot see the event itself.
 *
 * Same three-way branch as bookings_select_member: open_play is unaffected,
 * the organizer always sees everything, and for invite_only, visibility is
 * narrowed to whoever actually belongs there.
 */

drop policy booking_groups_select_member on public.booking_groups;

create policy booking_groups_select_member on public.booking_groups
  for select using (
    public.is_club_member(club_id)
    and (
      exists (
        select 1 from public.events e
        where e.id = booking_groups.event_id and e.game_mode = 'open_play'
      )
      or public.is_club_organizer(club_id)
      -- Membership in the specific booking group -- the natural per-row
      -- concept booking_groups has that table_rounds below does not.
      or public.is_booking_group_member(booking_groups.id)
      or public.event_has_my_placed_seat(booking_groups.event_id)
    )
  );

/*
 * table_rounds has no per-row group membership concept (a round belongs to a
 * table, not a booking group), so the third arm is organizer OR "already
 * seated at this event" only -- the same event_has_my_placed_seat (Task 3)
 * used above and in bookings_select_member.
 */
drop policy table_rounds_select_member on public.table_rounds;

create policy table_rounds_select_member on public.table_rounds
  for select using (
    public.is_club_member(club_id)
    and (
      exists (
        select 1 from public.events e
        where e.id = table_rounds.event_id and e.game_mode = 'open_play'
      )
      or public.is_club_organizer(club_id)
      or public.event_has_my_placed_seat(table_rounds.event_id)
    )
  );
