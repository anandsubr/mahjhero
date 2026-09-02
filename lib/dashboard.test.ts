import { describe, expect, it } from 'vitest';
import {
  ALL_CLUBS,
  buildChips,
  buildDashboardRows,
  headerScope,
  initialsFrom,
  inScope,
  needAFourthAlerts,
} from './dashboard';
import type { Club } from './clubs';
import type { ClubEvent } from './events';
import type { MyBooking } from './bookings';

const CLUBS: Club[] = [
  {
    id: 'club-1',
    name: 'Riverside Mah Jongg',
    slug: 'riverside',
    rhythm: 'Thursdays, 7pm',
    visibility: 'private',
    timezone: 'America/New_York',
  },
  {
    id: 'club-2',
    name: 'Harbour Tiles',
    slug: 'harbour',
    rhythm: 'First Sunday',
    visibility: 'private',
    timezone: 'America/New_York',
  },
];

const NOW = new Date('2026-09-01T12:00:00Z');

function event(over: Partial<ClubEvent> = {}): ClubEvent {
  return {
    id: 'event-1',
    club_id: 'club-1',
    series_id: null,
    title: 'Thursday night',
    venue_id: 'venue-1',
    venue_name: "Sara's place",
    notes: '',
    starts_at: '2026-09-02T23:00:00Z',
    ends_at: '2026-09-03T02:00:00Z',
    status: 'published',
    occurrence_date: null,
    overrides: [],
    table_count: 1,
    event_tables: [{ id: 'table-1', capacity: 4, label: 'Table 1' }],
    bookings: [],
    check_in_required: false,
    ...over,
  };
}

function booking(over: Partial<MyBooking> = {}): MyBooking {
  return {
    booking_id: 'booking-1',
    group_id: 'group-1',
    event_id: 'event-9',
    club_id: 'club-1',
    club_name: 'Riverside Mah Jongg',
    event_title: 'Sunday social',
    starts_at: '2026-09-06T23:00:00Z',
    club_timezone: 'America/New_York',
    venue_name: 'The hall',
    event_table_id: 'table-9',
    table_label: 'Table 1',
    status: 'confirmed',
    booked_by: 'me',
    booked_by_name: 'Me',
    offer_id: null,
    offer_seats: null,
    offer_expires_at: null,
    waitlist_position: null,
    check_in_required: false,
    check_in_state: null,
    check_in_opens_at: null,
    check_in_closes_at: null,
    ...over,
  };
}

describe('buildChips', () => {
  it('makes one chip per club, in order, with no "All clubs" entry', () => {
    expect(buildChips(CLUBS)).toEqual([
      { id: 'club-1', label: 'Riverside Mah Jongg' },
      { id: 'club-2', label: 'Harbour Tiles' },
    ]);
  });
});

describe('headerScope', () => {
  // No kicker: the name is "Your clubs" now, and a "YOUR CLUBS" kicker above
  // it is the same words twice. DashboardHeader guards on length, so an
  // empty string draws nothing. The single-club scope below keeps its
  // kicker — there "Your club" and the club's own name say different things.
  it('names the whole list without repeating itself when the scope is all', () => {
    expect(headerScope(CLUBS, ALL_CLUBS)).toEqual({
      kicker: '',
      name: 'Your clubs',
      meta: '2 clubs',
    });
  });

  // A one-club member never picks a chip — the row that would set `selected`
  // is not drawn for them — so their scope would otherwise read "All your
  // clubs · 1 club" forever, and the header would have no club to open.
  it('resolves a lone club to that club whatever the selection', () => {
    expect(headerScope([CLUBS[0]], ALL_CLUBS)).toEqual({
      kicker: 'Your club',
      name: 'Riverside Mah Jongg',
      meta: 'Thursdays, 7pm',
    });
  });

  it('still counts an empty list rather than resolving to nothing', () => {
    expect(headerScope([], ALL_CLUBS)).toEqual({
      kicker: '',
      name: 'Your clubs',
      meta: '0 clubs',
    });
  });

  it("uses the club's own rhythm when one is picked", () => {
    expect(headerScope(CLUBS, 'club-1')).toEqual({
      kicker: 'Your club',
      name: 'Riverside Mah Jongg',
      meta: 'Thursdays, 7pm',
    });
  });

  it('falls back to the all-clubs scope for an unknown id', () => {
    expect(headerScope(CLUBS, 'club-gone').name).toBe('Your clubs');
    // …unless there is only one club it could have meant.
    expect(headerScope([CLUBS[0]], 'club-gone').name).toBe('Riverside Mah Jongg');
  });
});

describe('initialsFrom', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsFrom('Jean Wu')).toBe('JW');
    expect(initialsFrom('  ada  byron  lovelace ')).toBe('AB');
  });

  it('returns empty for a name that was never set', () => {
    expect(initialsFrom('')).toBe('');
    expect(initialsFrom('   ')).toBe('');
  });

  // `word[0]` returns one UTF-16 code unit. A name starting with an astral
  // character (an emoji, or a supplementary-plane letter) is a surrogate
  // pair, so indexing yields a lone unpaired high surrogate — which renders
  // in the avatar as a replacement glyph, not a letter.
  it('keeps an astral first character whole', () => {
    // U+1D49C MATHEMATICAL SCRIPT CAPITAL A, then a plain ASCII surname.
    expect(initialsFrom('\u{1D49C}da Lovelace')).toBe('\u{1D49C}L');
  });
});

describe('inScope', () => {
  it('admits everything under all clubs', () => {
    expect(inScope('club-2', ALL_CLUBS)).toBe(true);
  });

  it('admits only the picked club otherwise', () => {
    expect(inScope('club-2', 'club-1')).toBe(false);
    expect(inScope('club-1', 'club-1')).toBe(true);
  });
});

describe('buildDashboardRows', () => {
  it('carries a booking through as a non-joinable row', () => {
    const rows = buildDashboardRows({
      bookings: [booking()],
      events: [],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].eventId).toBe('event-9');
    expect(rows[0].joinable).toBe(false);
    expect(rows[0].booking?.booking_id).toBe('booking-1');
  });

  it('adds an open event the viewer is not in as joinable', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [event()],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].joinable).toBe(true);
    expect(rows[0].clubName).toBe('Riverside Mah Jongg');
    expect(rows[0].timezone).toBe('America/New_York');
  });

  it('never lists an event twice when the viewer is booked into it', () => {
    const rows = buildDashboardRows({
      bookings: [booking({ event_id: 'event-1' })],
      events: [event()],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].joinable).toBe(false);
  });

  // One assertion per exclusion path. These were a single test asserting
  // `rows).toEqual([])` over all three events at once, which any two of them
  // could regress under without the assertion changing.
  it('drops an event with no free seat', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          id: 'full',
          bookings: [
            { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'c', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-1' },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('drops a cancelled event', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [event({ id: 'cancelled', status: 'cancelled' })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('drops an event that has already started', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [event({ id: 'past', starts_at: '2026-08-01T23:00:00Z' })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('drops an event the viewer is waitlisted on, without a booking row', () => {
    const rows = buildDashboardRows({
      bookings: [],
      events: [
        event({
          bookings: [
            { profile_id: 'me', status: 'waitlisted', event_table_id: null },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('sorts soonest first across sources', () => {
    const rows = buildDashboardRows({
      bookings: [booking({ event_id: 'later', starts_at: '2026-09-10T23:00:00Z' })],
      events: [event({ id: 'sooner', starts_at: '2026-09-02T23:00:00Z' })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(rows.map((r) => r.eventId)).toEqual(['sooner', 'later']);
  });
});

describe('needAFourthAlerts', () => {
  const threeSeated = [
    { profile_id: 'a', status: 'confirmed' as const, event_table_id: 'table-1' },
    { profile_id: 'b', status: 'confirmed' as const, event_table_id: 'table-1' },
    { profile_id: 'c', status: 'confirmed' as const, event_table_id: 'table-1' },
  ];

  it('raises one alert for a table one short and starting inside 48 hours', () => {
    const alerts = needAFourthAlerts({
      events: [event({ bookings: threeSeated })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tableId).toBe('table-1');
    expect(alerts[0].clubName).toBe('Riverside Mah Jongg');
    expect(alerts[0].text).toContain('Thursday night');
  });

  it('stays silent for an event the viewer is already in', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          bookings: [
            ...threeSeated.slice(0, 2),
            { profile_id: 'me', status: 'confirmed', event_table_id: 'table-1' },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });

  it('stays silent more than 48 hours out', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({ starts_at: '2026-09-20T23:00:00Z', bookings: threeSeated }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });

  it('stays silent for a cancelled event', () => {
    const alerts = needAFourthAlerts({
      events: [event({ status: 'cancelled', bookings: threeSeated })],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });

  // The two-table cases, which nothing exercised. `needAFourthAlerts` counts
  // per table (`confirmedOnTable`) while `hasFreeSeat` — the gate
  // `buildDashboardRows` uses — sums capacity across the whole event, so the
  // two disagree in shape by design. These pin what "per table" actually
  // means when an event has more than one.
  const twoTables = [
    { id: 'table-1', capacity: 4, label: 'Table 1' },
    { id: 'table-2', capacity: 4, label: 'Table 2' },
  ];

  it('alerts only for the short table when a second one still has room', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          event_tables: twoTables,
          table_count: 2,
          bookings: [
            ...threeSeated,
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-2' },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tableId).toBe('table-1');
  });

  it('raises one alert per table when both are one seat short', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          event_tables: twoTables,
          table_count: 2,
          bookings: [
            ...threeSeated,
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-2' },
            { profile_id: 'e', status: 'confirmed', event_table_id: 'table-2' },
            { profile_id: 'f', status: 'confirmed', event_table_id: 'table-2' },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.tableId)).toEqual(['table-1', 'table-2']);
    // Both alerts describe the same event — the key the screen renders them
    // under is `eventId:tableId`, so the pair must differ only in the table.
    expect(new Set(alerts.map((alert) => alert.eventId))).toEqual(
      new Set(['event-1']),
    );
  });

  // The negative of the pair above. The two-table cases covered "one short"
  // and "both short" but never "neither short", so a `needsAFourth` that had
  // come to return true for a table with two free seats would have passed
  // every multi-table test in this file.
  it('stays silent when neither table is short', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          event_tables: twoTables,
          table_count: 2,
          bookings: [
            { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
            { profile_id: 'c', status: 'confirmed', event_table_id: 'table-2' },
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-2' },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });
});
