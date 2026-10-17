/**
 * Pure merge step for the calendar-feed function: turns the owner's booking
 * rows and the rows of games they created into one FeedGame per event. No
 * Deno APIs, so vitest can exercise it directly; index.ts does the fetching.
 */
import type { FeedGame } from './ics.ts';

/** An `events` row with its club and venue embedded, as index.ts selects it. */
export type EventRow = {
  id: string;
  club_id: string;
  title: string | null;
  game_mode: FeedGame['gameMode'];
  starts_at: string;
  ends_at: string;
  notes: string | null;
  club: { name: string } | null;
  venue: { name: string } | null;
};

/** A `bookings` row with its event embedded. */
export type BookingRow = {
  status: 'confirmed' | 'waitlisted' | 'invited';
  event: EventRow | null;
};

const BOOKING_STATUS: Record<BookingRow['status'], FeedGame['status']> = {
  confirmed: 'going',
  waitlisted: 'waitlisted',
  invited: 'invited',
};

function toGame(e: EventRow, status: FeedGame['status']): FeedGame {
  return {
    eventId: e.id,
    clubId: e.club_id,
    title: e.title,
    gameMode: e.game_mode,
    clubName: e.club?.name ?? '',
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    venueName: e.venue?.name ?? '',
    notes: e.notes ?? '',
    status,
  };
}

/**
 * One game per event id, sorted by start time. A game the owner created is
 * `hosting` even if they also hold a booking for it.
 */
export function mergeFeedGames(bookings: BookingRow[], created: EventRow[]): FeedGame[] {
  const games = new Map<string, FeedGame>();
  for (const b of bookings) {
    if (b.event) games.set(b.event.id, toGame(b.event, BOOKING_STATUS[b.status]));
  }
  // Second, so hosting overwrites any booking for the same event.
  for (const e of created) {
    games.set(e.id, toGame(e, 'hosting'));
  }
  return [...games.values()].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}
