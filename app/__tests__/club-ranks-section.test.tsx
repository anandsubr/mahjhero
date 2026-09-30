import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Club } from '../../lib/clubs';

const SESSION = { session: { user: { id: 'test-user' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const fetchClubLeaderboard = vi.fn();
vi.mock('../../lib/leaderboard', () => ({
  fetchClubLeaderboard: (...a: unknown[]) => fetchClubLeaderboard(...a),
}));

import RanksSection from '../clubs/[id]/(hub)/ranks';
import { ClubHubContext } from '../../components/hub/ClubHubContext';

const CLUB: Club = {
  id: 'c1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: '',
  visibility: 'private',
  timezone: 'America/New_York',
  default_game_mode: 'open_play',
  code: 'RIVER24',
  cover_path: null,
  cover_color: 'accent2_800',
};

function renderSection() {
  render(
    <ClubHubContext.Provider value={{ club: CLUB, role: 'member', reloadClub: vi.fn() }}>
      <RanksSection />
    </ClubHubContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchClubLeaderboard.mockResolvedValue([
    { profile_id: 'p1', display_name: 'Ada', total_points: 120, rounds_won: 4 },
  ]);
});

describe('club hub Ranks section', () => {
  it("shows this club's leaderboard rows", async () => {
    renderSection();
    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(fetchClubLeaderboard).toHaveBeenCalledWith('c1');
  });

  it('marks the signed-in viewer\'s own row', async () => {
    fetchClubLeaderboard.mockResolvedValue([
      { profile_id: 'test-user', display_name: 'Pat', total_points: 60, rounds_won: 2 },
    ]);
    renderSection();
    expect(await screen.findByText('Pat (you)')).toBeTruthy();
  });
});
