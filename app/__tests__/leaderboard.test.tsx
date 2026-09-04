import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push }),
  usePathname: () => '/clubs/club-1/leaderboard',
  useLocalSearchParams: () => searchParams,
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'test-user' } },
    loading: false,
  }),
);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const fetchClub = vi.fn();

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchClub: (...args: unknown[]) => fetchClub(...args),
  };
});

const fetchClubLeaderboard = vi.fn();

vi.mock('../../lib/leaderboard', () => ({
  fetchClubLeaderboard: (...args: unknown[]) => fetchClubLeaderboard(...args),
}));

const fetchProfile = vi.fn();

vi.mock('../../lib/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/profile')>();
  return { ...actual, fetchProfile: (...args: unknown[]) => fetchProfile(...args) };
});

vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: vi.fn(async () => []),
  };
});

vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

import LeaderboardScreen from '../clubs/[id]/leaderboard';

const CLUB = {
  id: 'club-1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private' as const,
  timezone: 'America/New_York',
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.id = 'club-1';
  useSessionMock.mockReturnValue({
    session: { user: { id: 'test-user' } },
    loading: false,
  });
  fetchClub.mockResolvedValue(CLUB);
  fetchClubLeaderboard.mockResolvedValue([
    { profile_id: 'p1', display_name: 'Ada', total_points: 120, rounds_won: 4 },
    { profile_id: 'p2', display_name: 'Ben', total_points: 80, rounds_won: 5 },
  ]);
  fetchProfile.mockResolvedValue(null);
});

describe('guard ordering', () => {
  it('redirects to sign-in instead of spinning forever when signed out', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<LeaderboardScreen />);
    const redirect = await screen.findByTestId('redirect');
    expect(redirect.getAttribute('data-href')).toBe('/sign-in');
    expect(fetchClub).not.toHaveBeenCalled();
    expect(fetchClubLeaderboard).not.toHaveBeenCalled();
  });
});

describe('LeaderboardScreen', () => {
  it('heads the screen with the club as kicker and Leaderboard as the name', async () => {
    render(<LeaderboardScreen />);
    expect(await screen.findByText('Leaderboard')).toBeTruthy();
    expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
  });

  it('ranks entries by the order the RPC already returns, numbering from 1', async () => {
    render(<LeaderboardScreen />);
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
    render(<LeaderboardScreen />);
    expect(await screen.findByText('Member')).toBeTruthy();
  });

  it('shows an empty state when the club has no recorded rounds', async () => {
    fetchClubLeaderboard.mockResolvedValue([]);
    render(<LeaderboardScreen />);
    await screen.findByText('Leaderboard');
    expect(screen.getByText('No rounds recorded yet.')).toBeTruthy();
  });

  it('degrades gracefully when the leaderboard fails to load, without blanking the club name', async () => {
    fetchClubLeaderboard.mockResolvedValue(null);
    render(<LeaderboardScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(
      screen.getByText('The leaderboard could not be loaded. Pull to refresh or try again shortly.'),
    ).toBeTruthy();
  });

  it('draws a back link to the club', async () => {
    render(<LeaderboardScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to the club' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-1');
  });
});
