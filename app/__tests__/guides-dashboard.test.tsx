import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClubsScreen from '../clubs/index';

const push = vi.fn();
const replace = vi.fn();

// Mutable so a test can put `?imported=40` on the URL the way
// `app/clubs/[id]/import.tsx` does after a successful import.
const searchParams: Record<string, string> = { id: 'club-1' };

// TabBar now compares the live route to each tab's own href rather than
// trusting `active` alone, so it needs `usePathname` mocked too. Defaults to
// the clubs list's own route; the club detail describe blocks below switch
// it to `/clubs/club-1`, since that screen renders `active="club"` while
// living at a different URL.
let pathname = '/clubs';

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  // Renders as a real anchor carrying the href, so a test can assert where a
  // link points. It used to render its children and drop `href` on the
  // floor, which made every `Link` in these screens untestable. The club
  // cards below nest a Pressable inside via `asChild`; a div inside an
  // anchor is valid, and the existing role-based queries still find it.
  //
  // Its one known infidelity: the real `Link asChild` merges `href`,
  // `onPress`, and `role="link"` straight onto its child rather than
  // wrapping it, whereas this mock wraps `children` in a genuine `<a>`. So a
  // test asserting `data-href` is verifying that `Link` received the href it
  // was given, not that the production DOM has this nested shape, and
  // `getByRole('button', …)` matches here — against the Pressable's own
  // `accessibilityRole` — where the real build would expose `role="link"`
  // on the merged anchor instead. `Element.closest` includes the element
  // itself in its match, which is why the `closest('a')` assertions below
  // still read correctly against this wrapped-anchor shape even though it
  // isn't the shape the web build actually produces.
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a data-href={href}>{children}</a>
  ),
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
  useLocalSearchParams: () => searchParams,
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire `useUnreadCounts`'s
  // fetch (now pulled in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// Module-scoped constant, not the fresh object per call this used to be:
// TabBar's badge now reads `useSession` too (via `useUnreadCounts`), and a
// fresh object there breaks the referential stability its
// `useCallback([session])` depends on, refiring the fetch on every render.
const SESSION: { session: { user: { id: string } } | null; loading: boolean } = {
  session: { user: { id: 'test-user' } },
  loading: false,
};
const useSessionMock = vi.fn(() => SESSION);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const fetchMyClubs = vi.fn();
const fetchClub = vi.fn();
const fetchRoster = vi.fn();
const fetchPendingInvites = vi.fn();
const deleteInvite = vi.fn();
const createInvite = vi.fn();
const sendClubInviteEmail = vi.fn();
const fetchMyRoles = vi.fn();
const importRoster = vi.fn();
const fetchUpcomingEvents = vi.fn();
const fetchMyUpcomingBookings = vi.fn();
const commitBooking = vi.fn();
const cancelBooking = vi.fn();
const fetchProfile = vi.fn();
const fetchGreetings = vi.fn();
const fetchMyPendingInvites = vi.fn();
const acceptClubInvite = vi.fn();
const declineClubInvite = vi.fn();

// One partial mock for the whole file, not one per describe block. Two
// `vi.mock` calls for the same specifier are both hoisted and only one
// survives, so the second block's `...actual` spread silently lost whatever
// the first factory did not list — which is how `MAX_ROSTER_ROWS` came back
// undefined at render time. `parseRoster`, `canInvite` and `MAX_ROSTER_ROWS`
// stay real here on purpose: they are pure and the screens' behaviour under
// test depends on what they actually do.
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchMyClubs: (...args: unknown[]) => fetchMyClubs(...args),
    fetchClub: (...args: unknown[]) => fetchClub(...args),
    fetchRoster: (...args: unknown[]) => fetchRoster(...args),
    fetchPendingInvites: (...args: unknown[]) => fetchPendingInvites(...args),
    deleteInvite: (...args: unknown[]) => deleteInvite(...args),
    createInvite: (...args: unknown[]) => createInvite(...args),
    sendClubInviteEmail: (...args: unknown[]) => sendClubInviteEmail(...args),
    fetchMyRoles: (...args: unknown[]) => fetchMyRoles(...args),
    importRoster: (...args: unknown[]) => importRoster(...args),
    fetchMyPendingInvites: (...args: unknown[]) => fetchMyPendingInvites(...args),
    acceptClubInvite: (...args: unknown[]) => acceptClubInvite(...args),
    declineClubInvite: (...args: unknown[]) => declineClubInvite(...args),
  };
});

// Same pattern as the lib/clubs mock above: `formatEventWhen` stays real
// (it is pure, and the whole point of the timezone test below is to exercise
// its actual Intl formatting), only `fetchUpcomingEvents` is stubbed.
vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchUpcomingEvents: (...args: unknown[]) => fetchUpcomingEvents(...args),
  };
});

// Same one-mock-per-specifier rule as above. `offerCountdown`, `waitlistLabel`
// and `needsAFourth` stay real: the dashboard's derivations run through them
// and stubbing them would test the stub rather than the screen.
vi.mock('../../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bookings')>();
  return {
    ...actual,
    fetchMyUpcomingBookings: (...args: unknown[]) => fetchMyUpcomingBookings(...args),
    commitBooking: (...args: unknown[]) => commitBooking(...args),
    cancelBooking: (...args: unknown[]) => cancelBooking(...args),
  };
});

vi.mock('../../lib/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/profile')>();
  return { ...actual, fetchProfile: (...args: unknown[]) => fetchProfile(...args) };
});

// Only fetchGreetings is a network call worth stubbing -- pickDailyGreeting
// and applyGreetingTemplate are pure, already covered directly by
// lib/greetings.test.ts (Task 7), and this test wants them to run for
// real so it is exercising the actual substitution logic, not a second
// hand-rolled copy of it. `vi.importActual` (not a plain object spread
// referencing an outer `import`) is required here: `vi.mock` factories are
// hoisted above every `import` in the file, so a factory that closed over
// a normally-imported binding would run before that import's assignment
// exists. Declaring `fetchGreetings` as a bare `vi.fn()` below works
// because — same as this file's existing `fetchPendingInvites` mock — the
// factory only reads it through a closure at call time, not at hoist time.
vi.mock('../../lib/greetings', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/greetings')>('../../lib/greetings');
  return {
    ...actual,
    fetchGreetings: (...args: unknown[]) => fetchGreetings(...args),
  };
});

const fetchClubLeaderboard = vi.fn();

vi.mock('../../lib/leaderboard', () => ({
  fetchClubLeaderboard: (...args: unknown[]) => fetchClubLeaderboard(...args),
}));

// TabBar (carried by every screen in this file) and, on the dashboard,
// ClubChips both now call `useUnreadCounts`, which reaches `fetchUnreadCounts`.
// `unreadLabel` stays real — UnreadBadge calls it, and it is the pure helper
// covered by lib/messages.test.ts.
const fetchUnreadCounts = vi.fn(async () => []);
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: () => fetchUnreadCounts(),
  };
});

// TabBar also now calls useNotificationsUnread for its Alerts badge --
// without this it falls through to a real, unmocked RPC call.
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

const isVisible = vi.fn((_key: string) => true);
const dismiss = vi.fn();
vi.mock('../../lib/use-guides', () => ({
  useGuides: () => ({ isVisible, dismiss, reset: vi.fn() }),
}));

const fetchHostChecklistCounts = vi.fn();
vi.mock('../../lib/guides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/guides')>();
  return { ...actual, fetchHostChecklistCounts: (id: string) => fetchHostChecklistCounts(id) };
});

const CLUB = {
  id: 'club-1', name: 'Riverside', slug: 'riverside', rhythm: '',
  visibility: 'private', timezone: 'America/New_York', default_game_mode: 'open_play',
};

beforeEach(() => {
  vi.clearAllMocks();
  isVisible.mockImplementation(() => true);
  fetchMyClubs.mockResolvedValue([CLUB]);
  fetchUpcomingEvents.mockResolvedValue([]);
  fetchMyUpcomingBookings.mockResolvedValue([]);
  fetchProfile.mockResolvedValue(null);
  fetchGreetings.mockResolvedValue([]);
  fetchMyPendingInvites.mockResolvedValue([]);
  fetchClubLeaderboard.mockResolvedValue([]);
  fetchHostChecklistCounts.mockResolvedValue({
    events: 0, members: 1, pendingInvites: 0, announcements: 0,
  });
});

describe('dashboard guides', () => {
  it('shows a new host the setup checklist with the next step as its action', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'host' }]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Get Riverside going')).toBeTruthy();
    expect(screen.getByText('Schedule your first game')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a game' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-1/events/new');
    expect(screen.queryByText('How MahjHero works')).toBeNull();
  });

  it('hides the checklist once the required steps are done', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'host' }]);
    fetchHostChecklistCounts.mockResolvedValue({
      events: 1, members: 2, pendingInvites: 0, announcements: 0,
    });
    render(<ClubsScreen />);
    await waitFor(() => expect(fetchHostChecklistCounts).toHaveBeenCalledWith('club-1'));
    expect(screen.queryByText('Get Riverside going')).toBeNull();
  });

  it('hides the checklist when its counts could not be read', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'host' }]);
    fetchHostChecklistCounts.mockResolvedValue(null);
    render(<ClubsScreen />);
    await waitFor(() => expect(fetchHostChecklistCounts).toHaveBeenCalled());
    expect(screen.queryByText('Get Riverside going')).toBeNull();
  });

  it('dismisses the checklist per club', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'host' }]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Got it: Get Riverside going' }));
    expect(dismiss).toHaveBeenCalledWith('host-checklist:club-1');
  });

  it('shows a player the how-it-works card, mentioning Invite', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'member' }]);
    render(<ClubsScreen />);
    expect(await screen.findByText('How MahjHero works')).toBeTruthy();
    expect(screen.getByText(/Invite to bring someone along/)).toBeTruthy();
    expect(fetchHostChecklistCounts).not.toHaveBeenCalled();
  });

  it('shows no player card to a co-organizer', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'co_organizer' }]);
    render(<ClubsScreen />);
    await waitFor(() => expect(fetchMyRoles).toHaveBeenCalled());
    await screen.findAllByText('Riverside');
    expect(screen.queryByText('How MahjHero works')).toBeNull();
  });

  it('shows no player card when roles could not be read', async () => {
    fetchMyRoles.mockResolvedValue(null);
    render(<ClubsScreen />);
    await screen.findAllByText('Riverside');
    expect(screen.queryByText('How MahjHero works')).toBeNull();
  });

  it('shows nothing a guide has been dismissed for', async () => {
    isVisible.mockImplementation(() => false);
    fetchMyRoles.mockResolvedValue([{ club_id: 'club-1', role: 'member' }]);
    render(<ClubsScreen />);
    await screen.findAllByText('Riverside');
    expect(screen.queryByText('How MahjHero works')).toBeNull();
  });
});
