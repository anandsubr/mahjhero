/**
 * Everything the dashboard derives, with no React and no network in sight.
 *
 * The screen used to compute nothing — it rendered `fetchMyUpcomingBookings`
 * straight down the page. The artboard asks for more: a club scope, a merged
 * list of your games and open ones you could still join, and a call for a
 * fourth. That is real logic, and it belongs somewhere it can be tested
 * without rendering a tree or mocking Supabase.
 */
import { needsAFourth, takesSeat } from './bookings';
import type { MyBooking } from './bookings';
import type { Club } from './clubs';
import { formatEventWhen } from './events';
import type { ClubEvent } from './events';

/**
 * Empty for a member who never set a display name — a magic-link signup
 * starts with `display_name = ''` and nothing forces one. The avatar draws a
 * person glyph in that case rather than a placeholder letter, which would be
 * a name the member never chose.
 */
export function initialsFrom(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    // `Array.from(word)[0]`, not `word[0]`: string indexing yields a single
    // UTF-16 code unit, so a name whose first character is astral produces a
    // lone unpaired surrogate — a replacement glyph in the avatar rather
    // than the letter the member chose. Array.from iterates code points.
    // The `?? ''` is unreachable — `filter(Boolean)` above has already
    // dropped every empty string — and is kept only so this line cannot
    // become a crash if that filter is ever loosened.
    .map((word) => (Array.from(word)[0] ?? '').toUpperCase())
    .join('');
}

// Mirrors components/MahjongTile.tsx's MahjongSuit type, deliberately
// duplicated rather than imported -- this file stays free of any
// components/ dependency (see this file's own header comment), and
// TypeScript's structural typing still checks every call site for real:
// a ClubGlyph value is assignable anywhere a MahjongSuit is expected, and
// vice versa, because the two lists have identical members. Keep them
// byte-identical if either ever changes.
export type ClubGlyph =
  | 'dots'
  | 'bamboo'
  | 'red-dragon'
  | 'green-dragon'
  | 'east-wind'
  | 'south-wind'
  | 'west-wind'
  | 'north-wind';

const CLUB_GLYPHS: ClubGlyph[] = [
  'dots',
  'bamboo',
  'red-dragon',
  'green-dragon',
  'east-wind',
  'south-wind',
  'west-wind',
  'north-wind',
];

/**
 * A club's own tile face, stable for a given id -- every member sees the
 * same glyph for the same club, everywhere it's shown (its chip, its
 * header, and the Messages list's club rows, via ThreadRow's `asTile`
 * treatment on ThreadAvatar), not a fresh pick per render. The game
 * screen no longer has its own small tile -- it reuses DashboardHeader's
 * "Your club" shape instead, which already carries this same glyph.
 * No fairness/collision-resistance requirement: a plain string hash into
 * 8 buckets is enough, this is decoration, not a security boundary.
 */
export function glyphForClub(clubId: string): ClubGlyph {
  let hash = 0;
  for (let i = 0; i < clubId.length; i++) {
    hash = (hash * 31 + clubId.charCodeAt(i)) | 0;
  }
  return CLUB_GLYPHS[Math.abs(hash) % CLUB_GLYPHS.length];
}

/** Live means it holds, is queued for, or has been invited to a seat;
 *  declined and cancelled do not. An invitee is not offered "Join"
 *  (commit_booking would refuse: an invite is their one active row) nor a
 *  Need-a-4th card for a game they already have an invite to. */
function viewerIsIn(event: ClubEvent, userId: string): boolean {
  return event.bookings.some(
    (row) =>
      row.profile_id === userId &&
      (row.status === 'confirmed' ||
        row.status === 'waitlisted' ||
        row.status === 'invited'),
  );
}

/** Seats taken at one table: confirmed, plus pending invites holding one
 *  (lib/bookings' takesSeat -- the database's own rule). */
function takenOnTable(event: ClubEvent, tableId: string): number {
  return event.bookings.filter(
    (row) => takesSeat(row) && row.event_table_id === tableId,
  ).length;
}

/** Pending game invites for the dashboard's Accept / Decline card, soonest
 *  first (my_upcoming_bookings already orders by starts_at). */
export function pendingGameInvites(bookings: MyBooking[]): MyBooking[] {
  return bookings.filter((booking) => booking.status === 'invited');
}

export type FourthAlert = {
  eventId: string;
  clubId: string;
  clubName: string;
  tableId: string;
  text: string;
};

/**
 * One alert per table that is one seat short and starting soon, for events
 * the viewer could actually take the seat at.
 *
 * The gate is `needsAFourth` itself, not a local rewrite of it. That rule
 * lives in three places already (here, `eventStatusLine`, and
 * `need_a_fourth_stage` in SQL) and `lib/bookings.ts` records that a fourth
 * copy is exactly how one of them fell out of sync.
 */
export function needAFourthAlerts(input: {
  events: ClubEvent[];
  clubs: Club[];
  userId: string;
  now?: Date;
}): FourthAlert[] {
  const now = input.now ?? new Date();
  const clubsById = new Map(input.clubs.map((club) => [club.id, club]));
  const alerts: FourthAlert[] = [];

  for (const event of input.events) {
    if (event.status !== 'published') continue;
    if (viewerIsIn(event, input.userId)) continue;
    const club = clubsById.get(event.club_id);
    if (!club) continue;

    for (const table of event.event_tables) {
      const short = needsAFourth(
        table.capacity,
        takenOnTable(event, table.id),
        new Date(event.starts_at),
        now,
      );
      if (!short) continue;
      alerts.push({
        eventId: event.id,
        clubId: event.club_id,
        clubName: club.name,
        tableId: table.id,
        text: `${formatEventWhen(event.starts_at, club.timezone)} — ${event.title}`,
      });
    }
  }

  return alerts;
}
