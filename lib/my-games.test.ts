import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { markEventSeen } from './events';
import { fetchClubGames, fetchClubsNextGame, fetchMyGames } from './my-games';
import { resetSeenEvents } from './seen-events';

const ROW = {
  event_id: 'e1', club_id: 'c1', club_name: 'Test Club', title: 'Open play night',
  game_mode: 'open_play', seating_mode: 'open_seating',
  starts_at: '2026-10-01T15:30:00Z', ends_at: '2026-10-01T18:30:00Z',
  club_timezone: 'America/New_York', venue_name: 'Sample Venue',
  seats_taken: 14, capacity: 24, capped: true,
  my_status: 'going', waitlist_position: null, table_label: null,
};

beforeEach(() => {
  rpc.mockReset();
  resetSeenEvents();
  vi.restoreAllMocks();
});

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
      updated: false,
    }]);
  });

  it('maps updated, and treats a missing updated as false', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ ...ROW, updated: true }, { ...ROW, event_id: 'e2', updated: false }, ROW],
      error: null,
    });
    const games = (await fetchMyGames(new Date(), new Date()))!;
    expect(games.map((g) => g.updated)).toEqual([true, false, false]);
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
      notes: 'Bring your own set', updated: false,
    }]);
  });

  it('maps updated, and treats a missing updated as false', async () => {
    rpc.mockResolvedValueOnce({
      data: [{ ...ROW, notes: null, updated: true }, { ...ROW, notes: null }],
      error: null,
    });
    const games = (await fetchClubGames('c1', new Date(), new Date()))!;
    expect(games.map((g) => g.updated)).toEqual([true, false]);
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

// Going back fast from Game detail can reload a list before mark_event_seen
// lands; this session's own mark wins over a row loaded too early.
describe('a game this session just marked seen', () => {
  const UPDATED = { data: [{ ...ROW, notes: null, updated: true }], error: null };

  function pendingMark() {
    let resolve!: (v: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const done = markEventSeen('e1');
    return { settle: async (v: unknown) => { resolve(v); await done; } };
  }

  it('shows no pill on a reload while the RPC has not resolved', async () => {
    pendingMark();
    rpc.mockResolvedValueOnce(UPDATED);
    const [club] = (await fetchClubGames('c1', new Date(), new Date()))!;
    expect(club.updated).toBe(false);
    rpc.mockResolvedValueOnce({ data: [{ ...ROW, updated: true }], error: null });
    const [mine] = (await fetchMyGames(new Date(), new Date()))!;
    expect(mine.updated).toBe(false);
  });

  it('shows no pill on a load that started before the mark settled', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    const mark = pendingMark();
    let resolveList!: (v: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise((r) => { resolveList = r; }));
    now.mockReturnValue(2000);
    const list = fetchClubGames('c1', new Date(), new Date());
    now.mockReturnValue(3000);
    await mark.settle({ data: null, error: null });
    resolveList(UPDATED);
    const [game] = (await list)!;
    expect(game.updated).toBe(false);
  });

  it('trusts the server again once the mark has settled (a later edit shows)', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    const mark = pendingMark();
    await mark.settle({ data: null, error: null });
    now.mockReturnValue(2000);
    rpc.mockResolvedValueOnce(UPDATED);
    const [game] = (await fetchClubGames('c1', new Date(), new Date()))!;
    expect(game.updated).toBe(true);
  });

  it('forgets a failed mark, so the pill stays', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const mark = pendingMark();
    await mark.settle({ data: null, error: { message: 'no such event' } });
    rpc.mockResolvedValueOnce(UPDATED);
    const [game] = (await fetchClubGames('c1', new Date(), new Date()))!;
    expect(game.updated).toBe(true);
  });

  it('only affects the game that was marked', async () => {
    pendingMark();
    rpc.mockResolvedValueOnce({
      data: [{ ...ROW, event_id: 'e2', notes: null, updated: true }], error: null,
    });
    const [game] = (await fetchClubGames('c1', new Date(), new Date()))!;
    expect(game.updated).toBe(true);
  });
});
