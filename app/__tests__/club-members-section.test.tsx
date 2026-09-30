import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Club } from '../../lib/clubs';

const searchParams: Record<string, string> = {};
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => searchParams,
}));

const fetchRoster = vi.fn();
const fetchPendingInvites = vi.fn();
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchRoster: (...a: unknown[]) => fetchRoster(...a),
    fetchPendingInvites: (...a: unknown[]) => fetchPendingInvites(...a),
  };
});

vi.mock('../../lib/use-guides', () => ({
  useGuides: () => ({ isVisible: () => false, dismiss: vi.fn(), reset: vi.fn() }),
}));

import MembersSection from '../clubs/[id]/(hub)/members';
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

const MEMBER_ROLE = [
  { profile_id: 'test-user', role: 'member' as const, display_name: 'Ada', skill_level: null },
];

function renderSection() {
  render(
    <ClubHubContext.Provider value={{ club: CLUB, role: 'member', reloadClub: vi.fn() }}>
      <MembersSection />
    </ClubHubContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  fetchRoster.mockResolvedValue(MEMBER_ROLE);
  fetchPendingInvites.mockResolvedValue([]);
});

/**
 * app/clubs/[id]/import.tsx redirects here with `?imported=N` after a
 * successful import (club-hub phase 2, Task 10 -- it used to redirect to
 * the old app/clubs/[id]/legacy.tsx). This section route's only own job,
 * besides wiring HubSection's pull-to-refresh, is reading that param off
 * the URL and handing it to ClubMembers.
 */
describe('club hub Members section', () => {
  it("shows this club's roster", async () => {
    renderSection();
    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(fetchRoster).toHaveBeenCalledWith('c1');
  });

  it('reads ?imported=N off the URL and shows the confirmation card', async () => {
    searchParams.imported = '3';
    renderSection();
    expect(await screen.findByText(/3 invitations sent\./)).toBeTruthy();
  });

  it('ignores a missing or non-positive imported param', async () => {
    renderSection();
    await screen.findByText('Ada');
    expect(screen.queryByText(/invitations sent\./)).toBeNull();
  });
});
