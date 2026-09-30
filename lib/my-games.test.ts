import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fetchClubGames, fetchClubsNextGame, fetchMyGames } from './my-games';

const ROW = {
  event_id: 'e1', club_id: 'c1', club_name: 'Test Club', title: 'Open play night',
  game_mode: 'open_play', seating_mode: 'open_seating',
  starts_at: '2026-10-01T15:30:00Z', ends_at: '2026-10-01T18:30:00Z',
  club_timezone: 'America/New_York', venue_name: 'Sample Venue',
  seats_taken: 14, capacity: 24, capped: true,
  my_status: 'going', waitlist_position: null, table_label: null,
};

beforeEach(() => rpc.mockReset());

describe('fetchMyGames', () => {
  it('calls my_games with ISO bounds and maps rows', async () => {
    rpc.mockResolvedValueOnce({ data: [ROW], error: null });
    const from = new Date('2026-09-29T00:00:00Z');
    const to = new Date('2026-10-29T00:00:00Z');
    const games = await fetchMyGames(from, to);
    expect(rpc).toHaveBeenCalledWith('my_games', {
      from_ts: from.toISOString(), to_ts: to.toISOString(),
    });
    expect(games).toEqual([{
      eventId: 'e1', clubId: 'c1', clubName: 'Test Club', title: 'Open play night',
      gameMode: 'open_play', seatingMode: 'open_seating',
      startsAt: '2026-10-01T15:30:00Z', timezone: 'America/New_York', venueName: 'Sample Venue',
      seatsTaken: 14, capacity: 24, myStatus: 'going', waitlistPosition: null, tableLabel: null,
    }]);
  });

  it('maps an uncapped game to capacity null', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...ROW, capped: false, capacity: 0 }], error: null });
    const [game] = (await fetchMyGames(new Date(), new Date()))!;
    expect(game.capacity).toBeNull();
  });

  it('returns null on error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect(await fetchMyGames(new Date(), new Date())).toBeNull();
  });
});

describe('fetchClubGames', () => {
  it('calls club_games with the club id and ISO bounds and maps rows, including notes', async () => {
    rpc.mockResolvedValueOnce({ data: [{ ...ROW, notes: 'Bring your own set' }], error: null });
    const from = new Date('2026-09-29T00:00:00Z');
    const to = new Date('2026-10-29T00:00:00Z');
    const games = await fetchClubGames('c1', from, to);
    expect(rpc).toHaveBeenCalledWith('club_games', {
      target_club: 'c1', from_ts: from.toISOString(), to_ts: to.toISOString(),
    });
    expect(games).toEqual([{
      eventId: 'e1', clubId: 'c1', clubName: 'Test Club', title: 'Open play night',
      gameMode: 'open_play', seatingMode: 'open_seating',
      startsAt: '2026-10-01T15:30:00Z', timezone: 'America/New_York', venueName: 'Sample Venue',
      seatsTaken: 14, capacity: 24, myStatus: 'going', waitlistPosition: null, tableLabel: null,
      notes: 'Bring your own set',
    }]);
  });

  it('maps an invited/not game and a null notes value', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ ...ROW, my_status: 'invited', notes: null }],
      error: null,
    });
    const [game] = (await fetchClubGames('c1', new Date(), new Date()))!;
    expect(game.myStatus).toBe('invited');
    expect(game.notes).toBeUndefined();
  });

  it('returns null on error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect(await fetchClubGames('c1', new Date(), new Date())).toBeNull();
  });
});

describe('fetchClubsNextGame', () => {
  it('maps rows to a club-id record', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ club_id: 'c1', next_starts_at: '2026-10-01T15:30:00Z' }], error: null,
    });
    expect(await fetchClubsNextGame()).toEqual({ c1: '2026-10-01T15:30:00Z' });
  });
});
