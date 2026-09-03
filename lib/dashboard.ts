/**
 * Everything the dashboard derives, with no React and no network in sight.
 *
 * The screen used to compute nothing — it rendered `fetchMyUpcomingBookings`
 * straight down the page. The artboard asks for more: a club scope, a merged
 * list of your games and open ones you could still join, and a call for a
 * fourth. That is real logic, and it belongs somewhere it can be tested
 * without rendering a tree or mocking Supabase.
 */
import { needsAFourth, seatsRemaining } from './bookings';
import type { MyBooking } from './bookings';
import type { Club } from './clubs';
import { formatEventWhen } from './events';
import type { ClubEvent } from './events';

/** The chip id standing for "no club filter". Not a club id. */
export const ALL_CLUBS = 'all';

export type Chip = { id: string; label: string };

export function buildChips(clubs: Club[]): Chip[] {
  return clubs.map((club) => ({ id: club.id, label: club.name }));
}

export type HeaderScope = { kicker: string; name: string; meta: string };

/**
 * An unknown id resolves to the all-clubs scope rather than throwing: the
 * selection is client state and a club can disappear underneath it (left,
 * removed, or the list reloaded), and the honest answer to "show me a club
 * you are no longer in" is the whole list.
 *
 * The artboard's meta was originally "N clubs · M members" here — both
 * halves are gone now: the member count was already dropped as faked (see
 * the spec's deferred item 4), and the club count itself was a redundant
 * subtitle under "Your clubs", so this scope now carries no meta at all.
 *
 * One club is the exception to both fallbacks. There is nothing to disambiguate
 * and no chip row to pick with, so a single-club list resolves to that club
 * whatever `selected` says.
 */
export function headerScope(clubs: Club[], selected: string): HeaderScope {
  const picked =
    selected === ALL_CLUBS
      ? null
      : (clubs.find((candidate) => candidate.id === selected) ?? null);
  // A one-club member's scope is never ambiguous even if they tap their own
  // chip: `selected` would carry that club's own id instead of ALL_CLUBS,
  // but `picked` resolves to the identical club either way, so this branch
  // returns the same result regardless of which one drew it. Resolving the
  // lone club here is what lets the header name it and be pressed into it.
  // Same derivation, for the same reason, as the screen's own `scopeClubId`.
  const club = picked ?? (clubs.length === 1 ? clubs[0] : null);
  if (!club) {
    return {
      // No kicker, and a shorter name. "YOUR CLUBS" above "All your clubs"
      // was the same words twice. The single-club scope below keeps its
      // kicker: there "Your club" and the club's own name differ.
      kicker: '',
      name: 'Your clubs',
      meta: '',
    };
  }
  return { kicker: 'Your club', name: club.name, meta: club.rhythm };
}

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

export function inScope(clubId: string, selected: string): boolean {
  return selected === ALL_CLUBS || clubId === selected;
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
 * header, the game screen's small tile), not a fresh pick per render.
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

export type DashboardRow = {
  eventId: string;
  clubId: string;
  clubName: string;
  title: string;
  startsAt: string;
  timezone: string;
  venueName: string;
  /** The viewer's own booking, when they have one. Null on a joinable or organizing row. */
  booking: MyBooking | null;
  joinable: boolean;
  /**
   * True only for an in-progress event the viewer organizes but holds no
   * booking at — mutually exclusive with `joinable` (that one is always a
   * future event) and always paired with `booking: null`. See
   * `buildDashboardRows`' own doc comment for why this exists.
   */
  organizing: boolean;
};

/** Live means it holds or is queued for a seat; declined and cancelled do not. */
function viewerIsIn(event: ClubEvent, userId: string): boolean {
  return event.bookings.some(
    (row) =>
      row.profile_id === userId &&
      (row.status === 'confirmed' || row.status === 'waitlisted'),
  );
}

function confirmedOnTable(event: ClubEvent, tableId: string): number {
  return event.bookings.filter(
    (row) => row.status === 'confirmed' && row.event_table_id === tableId,
  ).length;
}

function hasFreeSeat(event: ClubEvent): boolean {
  const capacity = event.event_tables.reduce(
    (total, table) => total + table.capacity,
    0,
  );
  const confirmed = event.bookings.filter(
    (row) => row.status === 'confirmed',
  ).length;
  return seatsRemaining(capacity, confirmed) > 0;
}

/**
 * The viewer's bookings first, then any open event they are not in, merged
 * and sorted by start.
 *
 * Bookings win the de-duplication: both sources can carry the same event, and
 * the booking is the richer row — it is what the offer, waitlist and check-in
 * controls hang off.
 *
 * A THIRD source, folded into the same loop as the joinable branch: an
 * in-progress event the viewer organizes (host or co-organizer) but holds no
 * booking at. Before this existed, an organizer who never booked their own
 * seat lost all access to their own game the instant it started — neither
 * `my_upcoming_bookings` (no booking to find) nor the joinable branch (which
 * requires `!started`) ever covered it. See the design doc for how this was
 * found: two organizer-created, self-unbooked games vanished from a real
 * dashboard at kickoff.
 *
 * `organizerClubIds` defaults to an empty set — every existing caller that
 * does not pass it gets exactly today's behavior, since an empty set can
 * never match `event.club_id`.
 */
export function buildDashboardRows(input: {
  bookings: MyBooking[];
  events: ClubEvent[];
  clubs: Club[];
  userId: string;
  organizerClubIds?: Set<string>;
  now?: Date;
}): DashboardRow[] {
  const now = input.now ?? new Date();
  const clubsById = new Map(input.clubs.map((club) => [club.id, club]));
  const organizerClubIds = input.organizerClubIds ?? new Set<string>();

  const rows: DashboardRow[] = input.bookings.map((booking) => ({
    eventId: booking.event_id,
    clubId: booking.club_id,
    clubName: booking.club_name,
    title: booking.event_title,
    startsAt: booking.starts_at,
    timezone: booking.club_timezone,
    venueName: booking.venue_name,
    booking,
    joinable: false,
    organizing: false,
  }));

  const seen = new Set(rows.map((row) => row.eventId));

  for (const event of input.events) {
    if (seen.has(event.id)) continue;
    if (event.status !== 'published') continue;
    if (viewerIsIn(event, input.userId)) continue;
    const club = clubsById.get(event.club_id);
    if (!club) continue;

    const started = new Date(event.starts_at).getTime() <= now.getTime();
    const ended = new Date(event.ends_at).getTime() <= now.getTime();

    if (started) {
      // The organizing branch. `ended` is checked unconditionally (not
      // just for a non-organizer) so a stale already-ended event is
      // refused outright; only once that passes does organizer status
      // decide it. Deliberately does NOT check hasFreeSeat -- an organizer
      // needs this row whether the table is full or not.
      if (ended || !organizerClubIds.has(event.club_id)) continue;
    } else {
      // The existing joinable branch, unchanged.
      if (!hasFreeSeat(event)) continue;
    }

    seen.add(event.id);
    rows.push({
      eventId: event.id,
      clubId: event.club_id,
      clubName: club.name,
      title: event.title,
      startsAt: event.starts_at,
      timezone: club.timezone,
      venueName: event.venue_name,
      booking: null,
      joinable: !started,
      organizing: started && !ended,
    });
  }

  return rows.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
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
        confirmedOnTable(event, table.id),
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
