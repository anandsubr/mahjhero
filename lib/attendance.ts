import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';
import { bookingErrorMessage } from './bookings';
import type { BookingStatus } from './bookings';
import type { SkillLevel } from './profile';

/**
 * The two states an organizer or member can record. `null` (NOT DETERMINED)
 * is deliberately excluded from this union — it is a property of a row's
 * absence, never a value this app writes. Defined here, not in bookings.ts:
 * bookings.ts's `MyBooking` needs this type too, which would otherwise make
 * this file and bookings.ts import from each other. TypeScript erases
 * type-only imports before anything runs, so the cycle that results (this
 * file importing `BookingStatus` from bookings.ts, bookings.ts importing
 * `AttendanceState` from here) is safe — there is no runtime cycle, only a
 * type-level one the compiler resolves statically. Do not duplicate this
 * union in bookings.ts instead: two structurally identical unions type-check
 * against each other right up until one of them gains a value.
 */
export type AttendanceState = 'arrived' | 'no_show';

/**
 * One person on the door list, as `event_attendance` returns them.
 *
 * `booking_status` null is what identifies a walk-in — somebody an organizer
 * recorded who holds no confirmed seat. `state` null means NOT DETERMINED:
 * nobody has said anything about this person yet. It is not a no-show, and
 * nothing in this app ever converts it into one.
 */
export type AttendanceRow = {
  profile_id: string;
  display_name: string;
  skill_level: SkillLevel | null;
  event_table_id: string | null;
  table_label: string | null;
  table_position: number | null;
  booking_status: BookingStatus | null;
  state: AttendanceState | null;
  recorded_by: string | null;
  recorded_at: string | null;
};

/**
 * Whether to DRAW the control. Not whether a write will land — the database
 * decides that, and it is the only opinion that counts. The two timestamps
 * come from the server precisely so the one-hour lead is not duplicated
 * here, where it could drift.
 *
 * Both null means the event never asked for check-in.
 */
export function checkInOpen(
  opensAt: string | null,
  closesAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!opensAt || !closesAt) return false;
  const t = now.getTime();
  return t >= Date.parse(opensAt) && t <= Date.parse(closesAt);
}

/** The door screen's header line. */
export function attendanceSummary(rows: AttendanceRow[]) {
  let here = 0;
  let notComing = 0;
  let unaccounted = 0;
  let walkIns = 0;
  let booked = 0;

  for (const r of rows) {
    if (r.booking_status === null) walkIns += 1;
    else booked += 1;
    if (r.state === 'arrived') here += 1;
    else if (r.state === 'no_show') notComing += 1;
    // Only a booked player can be unaccounted for. A walk-in with no state
    // is not a person the host is waiting on — they are already standing
    // there.
    else if (r.booking_status !== null) unaccounted += 1;
  }

  return { here, notComing, unaccounted, walkIns, booked };
}

export async function fetchEventAttendance(
  eventId: string,
): Promise<AttendanceRow[] | null> {
  try {
    const { data, error } = await supabase.rpc('event_attendance', {
      target_event: eventId,
    });
    if (error) {
      console.error('fetchEventAttendance failed', error);
      return null;
    }
    return (data ?? []) as AttendanceRow[];
  } catch (cause) {
    console.error('fetchEventAttendance failed', cause);
    return null;
  }
}

export async function recordAttendance(input: {
  eventId: string;
  profileId: string;
  state: AttendanceState;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('record_attendance', {
      target_event: input.eventId,
      target_profile: input.profileId,
      new_state: input.state,
    });
    if (error) {
      console.error('recordAttendance failed', error);
      // NOT error.message. `bookingErrorMessage` maps the six refusals
      // 20260827030000 raises onto friendly copy; relaying the raw text
      // shows a member the words "check-in is not enabled for this event".
      // lib/bookings.test.ts's guard fails if a message is ever unmapped.
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('recordAttendance failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function clearAttendance(input: {
  eventId: string;
  profileId: string;
}): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('clear_attendance', {
      target_event: input.eventId,
      target_profile: input.profileId,
    });
    if (error) {
      console.error('clearAttendance failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('clearAttendance failed', cause);
    return { error: GENERIC_ERROR };
  }
}
