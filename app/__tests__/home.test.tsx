import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real Screen renders react-native-web's inert RefreshControl, which
// never calls `onRefresh` on its own in jsdom (no pull gesture in a
// browser). Swapping in a button that exposes Home's `onRefresh` prop is
// the only way here to prove Home wires the right reload into it -- Screen
// itself (components/__tests__/Screen.test.tsx) already covers that the
// prop reaches the real RefreshControl and drives `refreshing`.
vi.mock('../../components/Screen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/Screen')>();
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => {
      const { onRefresh, ...rest } = props as typeof props & { onRefresh?: () => Promise<void> };
      return (
        <>
          {onRefresh ? (
            <button
              type="button"
              aria-label="refresh-control"
              onClick={() => void onRefresh()}
            />
          ) : null}
          <actual.default {...rest} />
        </>
      );
    },
  };
});

const push = vi.fn();
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  useRouter: () => ({ push, replace: vi.fn() }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const SESSION = { session: { user: { id: 'me', email: 'me@example.com' } }, loading: false };
vi.mock('../../lib/session', () => ({ useSession: () => SESSION }));

const GUIDES = { isVisible: (_k: string) => false, dismiss: vi.fn() };
vi.mock('../../lib/use-guides', () => ({ useGuides: () => GUIDES }));
vi.mock('../../lib/use-unread', () => ({ useUnreadCounts: () => ({ total: 0, byClub: {} }) }));
vi.mock('../../lib/use-notifications-unread', () => ({ useNotificationsUnread: () => 2 }));

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
  },
}));

const NEEDS = {
  clubInvites: [], gameInvites: [], offers: [], alerts: [], busy: false, error: null,
  notice: null, dismissNotice: vi.fn(), acceptClubInvite: vi.fn(), declineClubInvite: vi.fn(),
  acceptGameInvite: vi.fn(), declineGameInvite: vi.fn(), acceptOffer: vi.fn(),
  declineOffer: vi.fn(), takeSeat: vi.fn(), reload: vi.fn(),
};
vi.mock('../../lib/use-needs-you', () => ({ useNeedsYou: () => NEEDS }));

const fetchMyGames = vi.fn();
const fetchClubsNextGame = vi.fn();
vi.mock('../../lib/my-games', () => ({
  fetchMyGames: (...a: unknown[]) => fetchMyGames(...a),
  fetchClubsNextGame: () => fetchClubsNextGame(),
}));

const CLUB = {
  id: 'c1', name: 'Test Club', slug: 't', rhythm: '', visibility: 'private',
  timezone: 'America/New_York', default_game_mode: 'open_play', code: 'TEST1',
};
let myClubs: unknown[] = [CLUB];
vi.mock('../../lib/clubs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/clubs')>()),
  fetchMyClubs: async () => myClubs,
  fetchMyRoles: async () => [{ club_id: 'c1', role: 'member' }],
}));
vi.mock('../../lib/profile', () => ({
  fetchProfile: async () => ({ display_name: 'Anand' }),
}));

import HomeScreen from '../home';

const GAME = {
  eventId: 'e1', clubId: 'c1', clubName: 'Test Club', title: 'Tuesday game',
  gameMode: 'open_play', seatingMode: 'open_seating',
  startsAt: new Date(Date.now() + 86_400_000).toISOString(), timezone: 'America/New_York',
  venueName: 'Sample Venue', seatsTaken: 2, capacity: 8, myStatus: 'going',
  waitlistPosition: null, tableLabel: null,
};

beforeEach(() => {
  push.mockReset();
  store.clear();
  myClubs = [CLUB];
  GUIDES.isVisible = () => false;
  fetchMyGames.mockReset();
  fetchClubsNextGame.mockResolvedValue({});
});

describe('HomeScreen', () => {
  it('defaults to My games when something is upcoming', async () => {
    fetchMyGames.mockResolvedValue([GAME]);
    render(<HomeScreen />);
    expect(await screen.findByText('Tuesday game')).toBeTruthy();
    expect(screen.getByText('1 upcoming across 1 club')).toBeTruthy();
    expect(screen.getByRole('button', { name: /My games/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('defaults to Clubs when nothing is upcoming', async () => {
    fetchMyGames.mockResolvedValue([]);
    render(<HomeScreen />);
    expect(await screen.findByText('Join a club')).toBeTruthy();
    expect(screen.getByText('Test Club')).toBeTruthy();
  });

  it('shows the feed error with Retry', async () => {
    fetchMyGames.mockResolvedValueOnce(null).mockResolvedValue([GAME]);
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /My games/ }));
    expect(await screen.findByText('Could not load your games.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Tuesday game')).toBeTruthy();
  });

  it('opens a game, alerts and profile', async () => {
    fetchMyGames.mockResolvedValue([GAME]);
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /^Open Tuesday game/ }));
    expect(push).toHaveBeenCalledWith('/clubs/c1/events/e1');
    fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));
    expect(push).toHaveBeenCalledWith('/alerts');
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(push).toHaveBeenCalledWith('/profile');
  });

  it('switches to Calendar and remembers it', async () => {
    fetchMyGames.mockResolvedValue([GAME]);
    render(<HomeScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }));
    await waitFor(() => expect(store.get('home:myGamesMode:me')).toBe('calendar'));
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeTruthy();
  });

  it('shows the welcome card to a member with no clubs', async () => {
    myClubs = [];
    GUIDES.isVisible = (k: string) => k === 'welcome';
    fetchMyGames.mockResolvedValue([]);
    render(<HomeScreen />);
    expect(await screen.findByText('Welcome to MahjHero')).toBeTruthy();
    expect(screen.getByText('me@example.com')).toBeTruthy();
  });

  it('restores a saved Calendar choice on mount', async () => {
    store.set('home:myGamesMode:me', 'calendar');
    fetchMyGames.mockResolvedValue([GAME]);
    render(<HomeScreen />);
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeTruthy();
  });

  it('reloads the feed, clubs and needs-you data on pull to refresh', async () => {
    fetchMyGames.mockResolvedValue([GAME]);
    render(<HomeScreen />);
    await screen.findByText('Tuesday game');

    fetchMyGames.mockClear();
    fetchClubsNextGame.mockClear();
    NEEDS.reload.mockClear();

    fireEvent.click(screen.getByLabelText('refresh-control'));

    await waitFor(() => expect(fetchMyGames).toHaveBeenCalled());
    expect(fetchClubsNextGame).toHaveBeenCalled();
    expect(NEEDS.reload).toHaveBeenCalled();
  });

  it('shows Retry when a calendar month fails, and refetches the month', async () => {
    store.set('home:myGamesMode:me', 'calendar');
    let monthFails = true;
    // The list feed spans 120 days; a calendar month spans at most 31.
    fetchMyGames.mockImplementation(async (from: Date, to: Date) => {
      const isMonth = to.getTime() - from.getTime() < 40 * 86_400_000;
      if (isMonth && monthFails) return null;
      return [GAME];
    });
    render(<HomeScreen />);
    expect(await screen.findByText('Could not load your games.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next month' })).toBeNull();
    monthFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Next month' })).toBeTruthy();
  });
});
