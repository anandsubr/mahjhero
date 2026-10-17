import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ClubLeaderboard from '../ClubLeaderboard';

const fetchClubLeaderboard = vi.fn();

vi.mock('../../lib/leaderboard', () => ({
  fetchClubLeaderboard: (...args: unknown[]) => fetchClubLeaderboard(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fetchClubLeaderboard.mockResolvedValue([
    { profile_id: 'p1', display_name: 'Ada', total_points: 120, rounds_won: 4 },
    { profile_id: 'p2', display_name: 'Ben', total_points: 80, rounds_won: 5 },
  ]);
});

/**
 * Moved from app/__tests__/leaderboard.test.tsx (club-hub phase 2, Task 9):
 * the guard-ordering and club-identity-header assertions that used to live
 * there now belong to app/clubs/[id]/(hub)/_layout.tsx and
 * app/__tests__/club-hub-layout.test.tsx -- this component owns only the
 * rows, empty state, and load failure, so only those assertions moved with
 * it, unchanged.
 */
describe('ClubLeaderboard', () => {
  it('ranks entries by the order the RPC already returns, numbering from 1', async () => {
    render(<ClubLeaderboard clubId="club-1" userId="test-user" />);
    await screen.findByText('Ada');
    expect(screen.getByText('120 pts')).toBeTruthy();
    expect(screen.getByText('Ben')).toBeTruthy();
    expect(screen.getByText('80 pts')).toBeTruthy();
    expect(screen.getByText('4 rounds won')).toBeTruthy();
    expect(screen.getByText('5 rounds won')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('falls back to "Member" for an entry with no display name', async () => {
    fetchClubLeaderboard.mockResolvedValue([
      { profile_id: 'p1', display_name: '', total_points: 25, rounds_won: 1 },
    ]);
    render(<ClubLeaderboard clubId="club-1" userId="test-user" />);
    expect(await screen.findByText('Member')).toBeTruthy();
  });

  it("marks the viewer's own row", async () => {
    fetchClubLeaderboard.mockResolvedValue([
      { profile_id: 'p1', display_name: 'Ada', total_points: 120, rounds_won: 4 },
      { profile_id: 'test-user', display_name: 'Pat', total_points: 60, rounds_won: 2 },
    ]);
    render(<ClubLeaderboard clubId="club-1" userId="test-user" />);
    expect(await screen.findByText('Pat (you)')).toBeTruthy();
    expect(screen.getByTestId('leaderboard-row-mine').textContent).toContain('Pat (you)');
    expect(screen.getByText('Ada')).toBeTruthy();
  });

  it('shows an empty state when the club has no recorded rounds', async () => {
    fetchClubLeaderboard.mockResolvedValue([]);
    render(<ClubLeaderboard clubId="club-1" userId="test-user" />);
    expect(await screen.findByText('No rounds recorded yet.')).toBeTruthy();
  });

  it('degrades gracefully when the leaderboard fails to load', async () => {
    fetchClubLeaderboard.mockResolvedValue(null);
    render(<ClubLeaderboard clubId="club-1" userId="test-user" />);
    expect(
      await screen.findByText(
        'The leaderboard could not be loaded. Pull to refresh or try again shortly.',
      ),
    ).toBeTruthy();
  });
});
