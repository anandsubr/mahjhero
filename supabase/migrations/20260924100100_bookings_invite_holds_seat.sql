/*
 * Game invites, schema half. 'invited' arrived alone in 20260924100000.
 *
 * invite_holds_seat is NULL for every non-invited row. For an invited row:
 *   true  -- the invite holds a seat: at event_table_id when that is set, or
 *            an "any table" seat counted at event level when it is null
 *            (commit_booking with an any-table group, or a held table the
 *            host has since removed -- remove_event_table unseats rather
 *            than ejects, exactly as it does a confirmed booking);
 *   false -- the game was full when the invite was sent. It holds nothing
 *            and therefore can never name a table; accepting it joins the
 *            waitlist.
 *
 * A seat is TAKEN by status = 'confirmed' OR (status = 'invited' and
 * invite_holds_seat). table_free_seats, event_free_seats and
 * need_a_fourth_stage are redefined to say so in 20260924101000.
 *
 * Every path that moves a row OUT of 'invited' (accept, decline, withdraw,
 * the start-of-game sweep, cancel_event and friends) must set
 * invite_holds_seat = null in the same UPDATE, or the first check below
 * refuses it.
 */
alter table public.bookings
  add column invite_holds_seat boolean;

alter table public.bookings
  add constraint bookings_invite_holds_seat_iff_invited check (
    (status = 'invited') = (invite_holds_seat is not null)
  ),
  add constraint bookings_unheld_invite_has_no_table check (
    invite_holds_seat is not false or event_table_id is null
  );

/*
 * One active booking per person per event now includes a pending invite:
 * a member already booked, waitlisted OR invited cannot be invited (or
 * book) again. Recreated, not altered -- a partial index's predicate
 * cannot be changed in place. No 'invited' rows exist yet, so the rebuild
 * cannot fail on existing data.
 */
drop index public.bookings_one_active_per_person_idx;
create unique index bookings_one_active_per_person_idx
  on public.bookings (event_id, profile_id)
  where status in ('confirmed', 'waitlisted', 'invited');
