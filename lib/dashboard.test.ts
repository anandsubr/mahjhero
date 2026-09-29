import { describe, expect, it } from 'vitest';
import {
  glyphForClub,
  initialsFrom,
  needAFourthAlerts,
  pendingGameInvites,
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
    default_game_mode: 'open_play',
    code: 'TESTCODE',
  },
  {
    id: 'club-2',
    name: 'Harbour Tiles',
    slug: 'harbour',
    rhythm: 'First Sunday',
    visibility: 'private',
    timezone: 'America/New_York',
    default_game_mode: 'open_play',
    code: 'TESTCODE',
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
    fee_cents: 0,
    min_spend_cents: 0,
    game_mode: 'open_play',
    // The column's own `not null default` (20260906100000). Nothing in this
    // suite branches on it; it is here because `ClubEvent` now carries the
    // field for Task 8's door list.
    seating_mode: 'assigned_tables',
    // `null` (uncapped) is the column's own default. Nothing in this suite
    // branches on it either; it is here because `ClubEvent` now carries the
    // field, added for Task 9's edit-form fix.
    capacity: null,
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
    fee_cents: 0,
    min_spend_cents: 0,
    ...over,
  };
}

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
describe('needAFourthAlerts', () => {
  const threeSeated = [
    { profile_id: 'a', status: 'confirmed' as const, event_table_id: 'table-1', group_id: 'g-a' },
    { profile_id: 'b', status: 'confirmed' as const, event_table_id: 'table-1', group_id: 'g-b' },
    { profile_id: 'c', status: 'confirmed' as const, event_table_id: 'table-1', group_id: 'g-c' },
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
            { profile_id: 'me', status: 'confirmed', event_table_id: 'table-1', group_id: 'g-me' },
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

  it('stays silent for a table one short in an event that has already started', () => {
    // Newly reachable input as of this branch's fetchUpcomingEvents widening
    // (ends_at, not starts_at) -- an in-progress event can appear in `events`
    // here for the first time. needsAFourth's own `until > 0` guard
    // (lib/bookings.ts) is what has to keep this silent, not any filtering
    // needAFourthAlerts does itself.
    const alerts = needAFourthAlerts({
      events: [
        event({ starts_at: '2026-09-01T10:00:00Z', bookings: threeSeated }),
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
  // per table (`confirmedOnTable`), so these pin what "per table" actually
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
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-2', group_id: 'g-d' },
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
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-2', group_id: 'g-d' },
            { profile_id: 'e', status: 'confirmed', event_table_id: 'table-2', group_id: 'g-e' },
            { profile_id: 'f', status: 'confirmed', event_table_id: 'table-2', group_id: 'g-f' },
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
            { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1', group_id: 'g-a' },
            { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1', group_id: 'g-b' },
            { profile_id: 'c', status: 'confirmed', event_table_id: 'table-2', group_id: 'g-c' },
            { profile_id: 'd', status: 'confirmed', event_table_id: 'table-2', group_id: 'g-d' },
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

describe('glyphForClub', () => {
  it('is stable for the same id across repeated calls', () => {
    const id = 'club-riverside-mahjong-abc123';
    expect(glyphForClub(id)).toBe(glyphForClub(id));
  });

  it('returns a value from the fixed 8-glyph set for a range of ids', () => {
    const valid = new Set([
      'dots', 'bamboo', 'red-dragon', 'green-dragon',
      'east-wind', 'south-wind', 'west-wind', 'north-wind',
    ]);
    const sampleIds = [
      'a', 'b', 'club-1', 'club-2', '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff', 'z'.repeat(40), '',
    ];
    for (const id of sampleIds) {
      expect(valid.has(glyphForClub(id))).toBe(true);
    }
  });

  it('two different ids can resolve to different glyphs', () => {
    // Not a fairness/distribution test (8 buckets, no uniformity
    // requirement) -- just confirms the hash isn't a constant that always
    // returns the same glyph regardless of input.
    const glyphs = new Set(
      ['club-1', 'club-2', 'club-3', 'club-4', 'club-5', 'club-6'].map(glyphForClub),
    );
    expect(glyphs.size).toBeGreaterThan(1);
  });
});

describe('game invites', () => {
  const threeSeated = [
    { profile_id: 'a', status: 'confirmed' as const, event_table_id: 'table-1', group_id: 'g-a' },
    { profile_id: 'b', status: 'confirmed' as const, event_table_id: 'table-1', group_id: 'g-b' },
    { profile_id: 'c', status: 'confirmed' as const, event_table_id: 'table-1', group_id: 'g-c' },
  ];

  it('lists pending invites, and only those, for the invite card', () => {
    const invite = booking({
      booking_id: 'inv',
      status: 'invited',
      invite_holds_seat: false,
      event_table_id: null,
      table_label: null,
    });
    expect(pendingGameInvites([booking(), invite])).toEqual([invite]);
  });

  it('does not call for a fourth over a held seat', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          bookings: [
            ...threeSeated,
            {
              profile_id: 'd',
              status: 'invited',
              event_table_id: 'table-1',
              group_id: 'g-a',
              invite_holds_seat: true,
            },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });

  it('does not ask someone already invited to the game to be the fourth', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          bookings: [
            ...threeSeated,
            {
              profile_id: 'me',
              status: 'invited',
              event_table_id: null,
              group_id: 'g-me',
              invite_holds_seat: false,
            },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toEqual([]);
  });

  it('ignores an invite that holds no seat when counting the table', () => {
    const alerts = needAFourthAlerts({
      events: [
        event({
          bookings: [
            ...threeSeated,
            {
              profile_id: 'd',
              status: 'invited',
              event_table_id: null,
              group_id: 'g-a',
              invite_holds_seat: false,
            },
          ],
        }),
      ],
      clubs: CLUBS,
      userId: 'me',
      now: NOW,
    });
    expect(alerts).toHaveLength(1);
  });
});
