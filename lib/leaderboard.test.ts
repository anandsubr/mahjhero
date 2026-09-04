import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

import { fetchClubLeaderboard, type LeaderboardEntry } from './leaderboard';

beforeEach(() => {
  rpc.mockReset();
});

function entry(over: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    profile_id: 'p1',
    display_name: 'Ada',
    total_points: 120,
    rounds_won: 4,
    ...over,
  };
}

describe('fetchClubLeaderboard', () => {
  it('returns the ranked entries on success', async () => {
    rpc.mockResolvedValue({ data: [entry(), entry({ profile_id: 'p2', display_name: 'Ben', total_points: 80, rounds_won: 3 })], error: null });
    const result = await fetchClubLeaderboard('club-1');
    expect(rpc).toHaveBeenCalledWith('club_leaderboard', { target_club: 'club-1' });
    expect(result).toEqual([
      entry(),
      entry({ profile_id: 'p2', display_name: 'Ben', total_points: 80, rounds_won: 3 }),
    ]);
  });

  it('returns an empty array for a club with no recorded rounds', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchClubLeaderboard('club-1')).toEqual([]);
  });

  it('returns null rather than throwing when the read errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection failure', code: '08006' } });
    expect(await fetchClubLeaderboard('club-1')).toBeNull();
  });

  it('returns null rather than throwing on a network failure', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    expect(await fetchClubLeaderboard('club-1')).toBeNull();
  });
});
