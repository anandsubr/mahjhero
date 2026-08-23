import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';
import type { SkillTier } from './events';
import type { SkillLevel } from './profile';

export type BookingStatus = 'confirmed' | 'waitlisted' | 'cancelled' | 'declined';
export type BookingGroupStatus = 'confirmed' | 'waitlisted' | 'cancelled';

// SkillTier and SkillLevel already exist — in lib/events.ts and
// lib/profile.ts respectively. Re-exported here so consumers of the seating
// components have one import, and NOT redefined: two structurally identical
// unions type-check against each other right up until one of them gains a
// value.
export type { SkillTier } from './events';

/** One live booking, as `event_seating` returns it. */
export type SeatOccupant = {
  booking_id: string;
  group_id: string;
  profile_id: string;
  display_name: string;
  skill_level: SkillLevel | null;
  event_table_id: string | null;
  status: BookingStatus;
  booked_by: string;
  booked_by_name: string;
  group_status: BookingGroupStatus;
  waitlist_position: number | null;
  created_at: string;
};

/** Every table's live bookings, as the seating screen groups them. */
export type TableSeating = {
  event_table_id: string | null;
  occupants: SeatOccupant[];
};

/** The whole picture for one game — `event_seating`'s rows, grouped by table. */
export type EventSeating = {
  tables: TableSeating[];
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
 * `details` carries a profile id for the two refusals that are about a
 * person; the caller substitutes the name it already holds from the roster.
 */
const BOOKING_REFUSALS: { code: string; contains: string; message: string }[] = [
  {
    code: '23514',
    contains: 'event not bookable',
    message: 'This game was cancelled.',
  },
  {
    code: '23514',
    contains: 'event already started',
    message: 'This game has already started.',
  },
  {
    code: '23514',
    contains: 'already booked',
    message: 'Someone in your group already has a seat at this game.',
  },
  {
    code: '23514',
    contains: 'not a member',
    message: 'Someone in your group is no longer in this club.',
  },
  {
    code: '23514',
    contains: 'table full',
    message: 'Someone just took the last seat at that table.',
  },
  {
    code: '23514',
    contains: 'no such table',
    message: 'That table is no longer part of this game.',
  },
  {
    code: '42501',
    contains: 'no such event',
    message: 'This game is no longer listed.',
  },
  {
    code: '23514',
    contains: 'offer expired',
    message: "That offer has expired — you're still on the waitlist.",
  },
  {
    code: '23514',
    contains: 'table does not need a fourth',
    message: 'That table needs more than one more player.',
  },
  {
    code: '23514',
    contains: 'booking already closed',
    message: 'That seat has already been given up.',
  },
  {
    code: '42501',
    contains: 'not your booking',
    message: 'That is not your seat to change.',
  },
  {
    code: '42501',
    contains: 'not your offer',
    message: 'Only the person who booked can answer that offer.',
  },
];

export function bookingErrorMessage(error: RpcError): string {
  if (!error) return GENERIC_ERROR;
  const text = error.message ?? '';
  const match = BOOKING_REFUSALS.find(
    (candidate) =>
      candidate.code === error.code && text.includes(candidate.contains),
  );
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
