import { describe, expect, it } from 'vitest';
import { mergeFeedGames, type BookingRow, type EventRow } from '../merge';

function event(id: string, overrides: Partial<EventRow> = {}): EventRow {
  return {
    id,
    club_id: 'club-1',
    title: `Game ${id}`,
    game_mode: 'open_play',
    starts_at: '2026-10-01T15:30:00+00:00',
    ends_at: '2026-10-01T18:30:00+00:00',
    notes: 'Bring tiles',
    club: { name: 'Test Club' },
    venue: { name: 'Town Hall' },
    ...overrides,
  };
}

function booking(status: BookingRow['status'], e: EventRow): BookingRow {
  return { status, event: e };
}

describe('mergeFeedGames', () => {
  it('maps a confirmed booking to going, with the event fields carried over', () => {
    expect(mergeFeedGames([booking('confirmed', event('e1'))], [])).toEqual([
      {
        eventId: 'e1',
        clubId: 'club-1',
        title: 'Game e1',
        gameMode: 'open_play',
        clubName: 'Test Club',
        startsAt: '2026-10-01T15:30:00+00:00',
        endsAt: '2026-10-01T18:30:00+00:00',
        venueName: 'Town Hall',
        notes: 'Bring tiles',
        status: 'going',
      },
    ]);
  });

  it('keeps waitlisted and invited statuses', () => {
    const games = mergeFeedGames(
      [
        booking('waitlisted', event('e1')),
        booking('invited', event('e2', { starts_at: '2026-10-02T15:30:00+00:00' })),
      ],
      [],
    );
    expect(games.map((g) => [g.eventId, g.status])).toEqual([
      ['e1', 'waitlisted'],
      ['e2', 'invited'],
    ]);
  });

  it('lists a game the owner created and also booked once, as hosting', () => {
    const e = event('e1');
    for (const status of ['confirmed', 'waitlisted', 'invited'] as const) {
      const games = mergeFeedGames([booking(status, e)], [e]);
      expect(games).toHaveLength(1);
      expect(games[0].status).toBe('hosting');
    }
  });

  it('includes created games with no booking as hosting', () => {
    const games = mergeFeedGames([], [event('e1')]);
    expect(games.map((g) => g.status)).toEqual(['hosting']);
  });

  it('sorts by start time and skips bookings with no event', () => {
    const games = mergeFeedGames(
      [
        booking('confirmed', event('late', { starts_at: '2026-10-05T15:30:00+00:00' })),
        { status: 'confirmed', event: null },
      ],
      [event('early', { starts_at: '2026-10-01T10:00:00+00:00' })],
    );
    expect(games.map((g) => g.eventId)).toEqual(['early', 'late']);
  });

  it('falls back to empty strings for missing club, venue and notes', () => {
    const [g] = mergeFeedGames([], [event('e1', { club: null, venue: null, notes: null })]);
    expect([g.clubName, g.venueName, g.notes]).toEqual(['', '', '']);
  });
});
