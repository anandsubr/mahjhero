import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';
import type { SkillTier } from './events';
import type { SkillLevel } from './profile';
import type { AttendanceState } from './attendance';

export type BookingStatus = 'confirmed' | 'waitlisted' | 'cancelled' | 'declined';
export type BookingGroupStatus = 'confirmed' | 'waitlisted' | 'cancelled';

// SkillTier and SkillLevel already exist — in lib/events.ts and
// lib/profile.ts respectively. Re-exported here so consumers of the seating
// components have one import, and NOT redefined: two structurally identical
// unions type-check against each other right up until one of them gains a
// value.
export type { SkillTier } from './events';
export type { SkillLevel } from './profile';

/**
 * One live booking, as `event_seating` returns it.
 *
 * `status` is narrower than `BookingStatus`: `event_seating`'s own
 * `where b.status in ('confirmed', 'waitlisted')` (20260825070000) means a
 * cancelled or declined booking can never appear in this field. Typed to
 * match, so a caller that mishandles 'cancelled'/'declined' here is a
 * compile error rather than dead code nobody notices.
 */
export type SeatOccupant = {
  booking_id: string;
  group_id: string;
  profile_id: string;
  display_name: string;
  skill_level: SkillLevel | null;
  event_table_id: string | null;
  status: 'confirmed' | 'waitlisted';
  booked_by: string;
  booked_by_name: string;
  group_status: BookingGroupStatus;
  waitlist_position: number | null;
  created_at: string;
};

export type PromotionOffer = {
  id: string;
  group_id: string;
  offered_seat_count: number;
  expires_at: string;
};

/** A row of "Your games". */
export type MyBooking = {
  booking_id: string;
  group_id: string;
  event_id: string;
  club_id: string;
  club_name: string;
  event_title: string;
  starts_at: string;
  club_timezone: string;
  venue_name: string;
  event_table_id: string | null;
  table_label: string | null;
  status: BookingStatus;
  booked_by: string;
  booked_by_name: string;
  offer_id: string | null;
  offer_seats: number | null;
  offer_expires_at: string | null;
  waitlist_position: number | null;
  check_in_required: boolean;
  check_in_state: AttendanceState | null;
  /** Null when the event never asked for check-in. */
  check_in_opens_at: string | null;
  check_in_closes_at: string | null;
};

export type BookingOutcome = {
  // Three, not two: booking_result reports a cancelled group as
  // 'cancelled', and the data layer reads it back after a cancellation.
  outcome: 'seated' | 'waitlisted' | 'cancelled';
  split: boolean;
  group_id: string | null;
  waitlist_position: number | null;
  offer: { id: string; seats: number; expires_at: string } | null;
  placements: {
    profile_id: string;
    event_table_id: string | null;
    table_label: string | null;
  }[];
};

type RpcError = { code?: string; message?: string; details?: string } | null;

/**
 * The refusal vocabulary, in the same shape as lib/events.ts's
 * RPC_ERROR_MESSAGES and for the same reason: plan 3 shipped a build that
 * reported every validation refusal as "Check your connection", which is
 * both wrong and unactionable. A refusal the database wrote is a sentence
 * the member can do something about.
 *
 * Keyed on MESSAGE TEXT ONLY. `codes` below is informational, kept for a
 * reader who wants to know where a refusal comes from — it is never
 * compared. The first version of this vocabulary matched on `code` AND
 * `contains`, which is wrong: the same message is raised with different
 * SQLSTATEs by different functions ('no such table' is 23514 from
 * plan_seating, 42501 from place_booking, and P0002 from
 * call_for_a_fourth/remove_event_table; 'no such event' is 42501 from
 * assert_event_bookable and P0002 from cancel_event/add_event_table). With
 * only one 23514 entry for 'no such table', every site but plan_seating's
 * fell through to GENERIC_ERROR — an organizer moving a booking onto a
 * table an admin had just removed was told to check their connection. The
 * message is the thing the client and the member both care about; Postgres
 * picks the code per call site, not per meaning, so the code cannot be part
 * of the match.
 *
 * `details` carries a profile id for the two refusals that are about a
 * person; the caller substitutes the name it already holds from the roster.
 *
 * Three entries are ordered deliberately: 'that person is not a member of
 * this club' before 'not a member of this club' before 'not a member',
 * because each shorter string is a substring of the ones above it and
 * `Array.find` returns the first match. The first of the three is
 * record_attendance's own refusal (20260827030000_attendance_mutations.sql)
 * for a walk-in target who has left the club since the roster was fetched;
 * left unordered, it used to fall into 'not a member of this club' and told
 * the host recording the walk-in that THEY had been removed from their own
 * club, rather than naming the person being added.
 *
 * Not every message the day-8 migrations raise appears here — some are
 * deliberately left to fall back to GENERIC_ERROR, and some belong to
 * lib/events.ts's own functions, not this module's. Both categories, and
 * why each one qualifies, are documented on the allowlist in
 * lib/bookings.test.ts's self-auditing test, which fails by naming the
 * exact string if a future raise site is left off both this vocabulary and
 * that allowlist.
 */
const BOOKING_REFUSALS: { contains: string; message: string; codes: string[] }[] = [
  {
    contains: 'event not bookable',
    message: 'This game was cancelled.',
    codes: ['23514'],
  },
  {
    contains: 'event already started',
    message: 'This game has already started.',
    codes: ['23514'],
  },
  {
    // `assert_players_bookable` raises this for a solo booking exactly as
    // it does for a group one — the caller can be the offending player
    // themselves. `details` does carry the offending profile id, but this
    // module has no caller identity to compare it against (bookSeat only
    // ever passes `[me]` — see the event screen — while BringSomeoneSheet's
    // commit can pass several players, so the module cannot assume "the
    // player" means "the caller" either way without threading the caller's
    // own id through every call site). Worded to read correctly either way
    // instead: true whether it was the caller alone or someone they were
    // booking for.
    contains: 'already booked',
    message: 'You or someone in your group already has a seat at this game.',
    codes: ['23514'],
  },
  {
    // Order before 'not a member of this club' below — see the note above.
    // record_attendance's own guard (20260827030000), raised when an
    // organizer tries to record a walk-in for someone who is no longer on
    // the club's roster (e.g. a co-organizer removed them mid-shift after
    // the door screen's roster was fetched).
    contains: 'that person is not a member of this club',
    message: 'That person is no longer a member of this club.',
    codes: ['23514'],
  },
  {
    // Order before 'not a member' below — see the note above.
    contains: 'not a member of this club',
    message: 'You are no longer a member of this club.',
    codes: ['42501'],
  },
  {
    contains: 'not a member',
    message: 'Someone in your group is no longer in this club.',
    codes: ['23514'],
  },
  {
    // assert_club_organizer, raised by call_for_a_fourth (among every other
    // host-only mutation). A member whose organizer role is revoked between
    // render and tap — or a stale screen — used to be told the connection
    // was down; this module actually calls call_for_a_fourth, so it owns
    // this mapping too (lib/events.ts's own copy covers its own functions).
    contains: 'not an organizer of this club',
    message: 'Only a club organizer can do that.',
    codes: ['42501'],
  },
  {
    contains: 'no players',
    message: 'Pick at least one player.',
    codes: ['23514'],
  },
  {
    contains: 'table does not need a fourth',
    message: 'That table needs more than one more player.',
    codes: ['23514'],
  },
  {
    contains: 'table full',
    message: 'Someone just took the last seat at that table.',
    codes: ['23514'],
  },
  {
    contains: 'no such table',
    message: 'That table is no longer part of this game.',
    codes: ['23514', '42501', 'P0002'],
  },
  {
    contains: 'no such event',
    message: 'This game is no longer listed.',
    codes: ['42501', 'P0002'],
  },
  {
    contains: 'no such offer',
    message: 'That offer no longer exists.',
    codes: ['42501'],
  },
  {
    contains: 'no such booking',
    message: 'That booking no longer exists.',
    codes: ['42501'],
  },
  {
    contains: 'no such group',
    message: 'That booking group no longer exists.',
    codes: ['42501'],
  },
  {
    contains: 'offer expired',
    message: "That offer has expired — you're still on the waitlist.",
    codes: ['23514'],
  },
  {
    contains: 'booking already closed',
    message: 'That seat has already been given up.',
    codes: ['23514'],
  },
  {
    contains: 'booking not confirmed',
    message: 'Only a confirmed seat can be moved to a table.',
    codes: ['23514'],
  },
  {
    contains: 'not your booking',
    message: 'That is not your seat to change.',
    codes: ['42501'],
  },
  {
    contains: 'not your offer',
    message: 'Only the person who booked can answer that offer.',
    codes: ['42501'],
  },
  // The six below, plus 'that person is not a member of this club' up near
  // the top of this array (ordering forced it there — see the note above),
  // are raised by record_attendance/clear_attendance and their shared guard
  // assert_attendance_writable (20260827030000_attendance_mutations.sql,
  // check-in plan Task 4) — seven attendance-related entries in total.
  // Neither function is called from this file — lib/attendance.ts (check-in
  // plan Task 9) owns that — but they belong in this same vocabulary rather
  // than a parallel one: attendance refusals are still "a game/seat rule the
  // member can do something about", exactly what BOOKING_REFUSALS already
  // exists to translate, and 'no such event' below already proves this
  // table maps messages for functions this file never calls (it also
  // covers cancel_event/add_event_table). lib/attendance.ts is expected to
  // import bookingErrorMessage from here and call it directly rather than
  // relaying error.message or growing its own copy.
  {
    contains: 'event not open for check-in',
    message: 'This game was cancelled.',
    codes: ['23514'],
  },
  {
    contains: 'check-in is not enabled for this event',
    message: 'This game does not use check-in.',
    codes: ['23514'],
  },
  {
    contains: 'you can only check yourself in',
    message: 'Only an organizer can check someone else in.',
    codes: ['42501'],
  },
  {
    contains: 'check-in is not open for this event',
    message: 'Check-in is not open for this game right now.',
    codes: ['23514'],
  },
  {
    contains: 'you do not have a seat at this game',
    message: "You don't have a confirmed seat at this game.",
    codes: ['23514'],
  },
  {
    contains: 'you can only clear your own check-in',
    message: 'You can only undo your own check-in.',
    codes: ['42501'],
  },
];

export function bookingErrorMessage(error: RpcError): string {
  if (!error) return GENERIC_ERROR;
  const text = error.message ?? '';
  const match = BOOKING_REFUSALS.find((candidate) => text.includes(candidate.contains));
  return match ? match.message : GENERIC_ERROR;
}

// ---------------------------------------------------------------------------
// Pure helpers. No network, no mocks in their tests — the reason they are
// separated out at all.
// ---------------------------------------------------------------------------

const TIER_LABELS: Record<SkillTier, string> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
  mixed: 'any',
};

/**
 * The soft warning, and the whole of tier enforcement in this product. The
 * database does not check tiers; the member decides and the host can move
 * people afterwards. A member with no skill level set is never warned —
 * they have declared nothing to be mismatched against.
 */
export function tierWarning(
  tier: SkillTier,
  level: SkillLevel | null,
  tableLabel: string,
): string | null {
  if (tier === 'mixed') return null;
  if (level === null) return null;
  if (level === tier) return null;
  return `${tableLabel} is set up for ${TIER_LABELS[tier]} players. Book anyway?`;
}

const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

/**
 * Derived, never stored — the same rule need_a_fourth_stage applies in SQL.
 * Keeping the two in step matters: the screen shows the call and the cron
 * job announces it, and a member told about a table that shows nothing is
 * worse than not being told.
 */
export function needsAFourth(
  capacity: number,
  confirmed: number,
  startsAt: Date,
  now: Date,
): boolean {
  if (capacity < 2) return false;
  if (confirmed !== capacity - 1) return false;
  const until = startsAt.getTime() - now.getTime();
  return until > 0 && until <= FORTY_EIGHT_HOURS_MS;
}

/** Floors at zero: a table can hold more than it seats after a removal. */
export function seatsRemaining(capacity: number, confirmed: number): number {
  return Math.max(0, capacity - confirmed);
}

/**
 * The three-case "how many seats are left" rule, shared by the club list's
 * `eventStatusLine` (lib/events.ts) and each table's own `TableCard`. Bare
 * "0 seats free" is a sentence nobody writes — plan 3's visual review
 * caught a card that said "0 tables" for the identical reason — so a full
 * table says "Full" instead.
 *
 * This lived as two separate copies of the same three-case branch until a
 * pass over the branch found it: this app has already been bitten more
 * than once by one rule drifting across several call sites (the
 * "needs a fourth" gate reached three copies before one of them fell out of
 * sync). One function, two callers.
 */
export function seatsFreeLabel(free: number): string {
  if (free === 0) return 'Full';
  return `${free} ${free === 1 ? 'seat' : 'seats'} free`;
}

export function waitlistLabel(position: number): string {
  const rest = position % 100;
  const last = position % 10;
  const suffix =
    rest >= 11 && rest <= 13
      ? 'th'
      : last === 1
        ? 'st'
        : last === 2
          ? 'nd'
          : last === 3
            ? 'rd'
            : 'th';
  return `${position}${suffix} on the waitlist`;
}

export function offerCountdown(expiresAt: Date, now: Date): string {
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return 'Expired';
  const minutes = Math.ceil(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const minuteText = `${rest} ${rest === 1 ? 'minute' : 'minutes'}`;
  if (hours === 0) return `${minuteText} left`;
  const hourText = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  if (rest === 0) return `${hourText} left`;
  return `${hourText} ${minuteText} left`;
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

/**
 * Every live booking for one game, with names.
 *
 * Goes through the RPC rather than a select on `bookings` because
 * `profiles` is self-only (20260822180000) — a client-side join returns the
 * caller's own name and null for everybody else, with no error at all.
 */
export async function fetchEventSeating(
  eventId: string,
): Promise<SeatOccupant[] | null> {
  try {
    const { data, error } = await supabase.rpc('event_seating', {
      target_event: eventId,
    });
    if (error) {
      console.error('fetchEventSeating failed', error);
      return null;
    }
    return (data ?? []) as SeatOccupant[];
  } catch (cause) {
    console.error('fetchEventSeating failed', cause);
    return null;
  }
}

/**
 * The one open offer (if any) currently held for a group this caller
 * belongs to, for this event.
 *
 * A plain select on `promotion_offers`, not another RPC: its own policy
 * (`promotion_offers_select_group`, 20260825000000) is
 * `is_booking_group_member(group_id)`, which checks `bookings.profile_id =
 * auth.uid()` for that group. RLS already scopes this to an offer made to a
 * group the caller is actually in — nothing here needs to re-derive that.
 * `responded_at is null` is the same "still open" test the accept/decline
 * RPCs and the sweep job use; `.maybeSingle()` relies on
 * `promotion_offers_one_outstanding_idx` (one outstanding offer per group)
 * to guarantee at most one row.
 */
export async function fetchOpenOffer(
  eventId: string,
): Promise<PromotionOffer | null> {
  try {
    const { data, error } = await supabase
      .from('promotion_offers')
      .select('id, group_id, offered_seat_count, expires_at')
      .eq('event_id', eventId)
      .is('responded_at', null)
      .maybeSingle();

    if (error) {
      console.error('fetchOpenOffer failed', error);
      return null;
    }
    return (data as PromotionOffer | null) ?? null;
  } catch (cause) {
    console.error('fetchOpenOffer failed', cause);
    return null;
  }
}

export async function fetchMyUpcomingBookings(): Promise<MyBooking[] | null> {
  try {
    const { data, error } = await supabase.rpc('my_upcoming_bookings');
    if (error) {
      console.error('fetchMyUpcomingBookings failed', error);
      return null;
    }
    return (data ?? []) as MyBooking[];
  } catch (cause) {
    console.error('fetchMyUpcomingBookings failed', cause);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Writes. Every one returns the { error } channel; none of them rejects.
// ---------------------------------------------------------------------------

export async function proposeBooking(input: {
  eventId: string;
  players: string[];
  preferredTableId: string | null;
  allowSplit: boolean;
}): Promise<{ plan: BookingOutcome | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('propose_booking', {
      target_event: input.eventId,
      players: input.players,
      preferred: input.preferredTableId,
      allow_split: input.allowSplit,
    });
    if (error || !data) {
      console.error('proposeBooking failed', error);
      return { plan: null, error: bookingErrorMessage(error) };
    }
    return { plan: data as BookingOutcome, error: null };
  } catch (cause) {
    console.error('proposeBooking failed', cause);
    return { plan: null, error: GENERIC_ERROR };
  }
}

export async function commitBooking(input: {
  eventId: string;
  players: string[];
  preferredTableId: string | null;
  allowSplit: boolean;
}): Promise<{ result: BookingOutcome | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('commit_booking', {
      target_event: input.eventId,
      players: input.players,
      preferred: input.preferredTableId,
      allow_split: input.allowSplit,
    });
    if (error || !data) {
      console.error('commitBooking failed', error);
      return { result: null, error: bookingErrorMessage(error) };
    }
    return { result: data as BookingOutcome, error: null };
  } catch (cause) {
    console.error('commitBooking failed', cause);
    return { result: null, error: GENERIC_ERROR };
  }
}

export async function cancelBooking(
  bookingId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('cancel_booking', {
      target_booking: bookingId,
    });
    if (error) {
      console.error('cancelBooking failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('cancelBooking failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function declineBooking(
  bookingId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('decline_booking', {
      target_booking: bookingId,
    });
    if (error) {
      console.error('declineBooking failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('declineBooking failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function cancelBookingGroup(
  groupId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('cancel_booking_group', {
      target_group: groupId,
    });
    if (error) {
      console.error('cancelBookingGroup failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('cancelBookingGroup failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function placeBooking(
  bookingId: string,
  tableId: string | null,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('place_booking', {
      target_booking: bookingId,
      target_table: tableId,
    });
    if (error) {
      console.error('placeBooking failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('placeBooking failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function acceptPromotionOffer(
  offerId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('accept_promotion_offer', {
      target_offer: offerId,
    });
    if (error) {
      console.error('acceptPromotionOffer failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('acceptPromotionOffer failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function declinePromotionOffer(
  offerId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('decline_promotion_offer', {
      target_offer: offerId,
    });
    if (error) {
      console.error('declinePromotionOffer failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('declinePromotionOffer failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function callForAFourth(
  tableId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('call_for_a_fourth', {
      target_table: tableId,
    });
    if (error) {
      console.error('callForAFourth failed', error);
      return { error: bookingErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('callForAFourth failed', cause);
    return { error: GENERIC_ERROR };
  }
}
