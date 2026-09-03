import { useEffect } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TabBar from '../../components/TabBar';

const unreadCounts = vi.fn(
  async (): Promise<{ club_id: string | null; unread: number }[]> => [],
);
vi.mock('../../lib/messages', async () => {
  // UnreadBadge (rendered inside TabBar) calls the real `unreadLabel`, a
  // pure helper covered by lib/messages.test.ts — only `fetchUnreadCounts`
  // needs to be a controllable double here.
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    fetchUnreadCounts: () => unreadCounts(),
  };
});

let alertsUnreadCount = 0;
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => alertsUnreadCount,
}));

// Module-scoped constant, not a fresh object per render: TabBar now reads
// `useSession` (via `useUnreadCounts`), and a fresh object there would break
// the referential stability `useUnreadCounts`'s `useCallback([session])`
// depends on, refiring its effect on every render.
const SESSION = { session: { user: { id: 'test-user' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const replace = vi.fn();

// Controllable per test, the same way `replace` above is: TabBar's press
// handler now compares the current route to each tab's own href, so a test
// exercising that comparison needs to say what the current route is. Mutate
// this directly (`pathname = '/clubs/club-1'`) before rendering.
let pathname = '/dashboard-followups-under-test';

vi.mock('expo-router', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname,
  Redirect: ({ href }: { href: string }) => <div data-href={href} />,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useLocalSearchParams: () => ({}),
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire `useUnreadCounts`'s
  // fetch on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

beforeEach(() => {
  replace.mockClear();
  alertsUnreadCount = 0;
  // A route none of the four tabs' hrefs match, so a test that doesn't care
  // about the "already there" comparison (most of them) can't accidentally
  // pass because the default happens to coincide with a real tab route.
  pathname = '/dashboard-followups-under-test';
});

describe('TabBar', () => {
  it('renders all four destinations', () => {
    render(<TabBar active="club" />);
    for (const label of ['Club', 'Messages', 'Profile', 'Alerts']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('marks only the active tab', () => {
    render(<TabBar active="profile" />);
    expect(
      screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it.each([
    ['Club', '/clubs', 'alerts'],
    ['Messages', '/messages', 'club'],
    ['Profile', '/profile', 'club'],
    ['Alerts', '/alerts', 'club'],
  ] as const)('routes %s to %s', (label, href, otherActive) => {
    // Rendered with a different tab active than the one under test: the
    // active tab itself is a documented no-op (see the test below), so
    // testing routing for a tab requires it not already be selected.
    render(<TabBar active={otherActive} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(replace).toHaveBeenCalledWith(href);
  });

  it('does not navigate when the active tab is pressed', () => {
    // On the Club tab's own route, pressing it is still a documented no-op.
    pathname = '/clubs';
    render(<TabBar active="club" />);
    fireEvent.click(screen.getByRole('button', { name: 'Club' }));
    expect(replace).not.toHaveBeenCalled();
  });

  // The regression this file exists to catch: the club detail screen
  // (route /clubs/[id]) renders `active="club"` so the bar still highlights
  // Club, but /clubs/club-1 is not the Club tab's own route (/clubs). A
  // press handler that short-circuits on `selected` alone — as this one
  // used to — never calls `replace` here, stranding the member on a screen
  // whose highlighted Club button does nothing.
  it('still navigates a highlighted tab when its route is not the current one', () => {
    pathname = '/clubs/club-1';
    render(<TabBar active="club" />);
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Club' }));
    expect(replace).toHaveBeenCalledWith('/clubs');
  });

  // Ordinary messages never email, so this badge is the ONLY off-screen
  // signal a member gets. It is not decoration.
  it('badges the Messages tab with the unread total', async () => {
    unreadCounts.mockResolvedValueOnce([
      { club_id: 'c1', unread: 2 },
      { club_id: null, unread: 3 },
    ]);
    render(<TabBar active="club" />);
    expect(await screen.findByText('5')).toBeTruthy();
  });

  it('shows no badge when nothing is unread', async () => {
    unreadCounts.mockResolvedValueOnce([]);
    render(<TabBar active="club" />);
    await waitFor(() => expect(unreadCounts).toHaveBeenCalled());
    expect(screen.queryByText('0')).toBeNull();
  });

  // UnreadBadge's own <Text> never reaches assistive tech: this Pressable's
  // accessibilityLabel emits aria-label on react-native-web, which REPLACES
  // the accessible name computed from children (the badge included) rather
  // than merging with it. The count has to be composed into "Messages"
  // itself for a screen-reader user to ever hear it.
  it('composes the unread total into the Messages tab’s accessible name', async () => {
    unreadCounts.mockResolvedValueOnce([
      { club_id: 'c1', unread: 2 },
      { club_id: null, unread: 3 },
    ]);
    render(<TabBar active="club" />);
    expect(await screen.findByRole('button', { name: 'Messages, 5 unread' })).toBeTruthy();
  });

  it('carries no unread suffix on any tab when nothing is unread', async () => {
    unreadCounts.mockResolvedValueOnce([]);
    render(<TabBar active="club" />);
    await waitFor(() => expect(unreadCounts).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
  });

  it('badges the Alerts tab with the unread notification count', async () => {
    alertsUnreadCount = 2;
    render(<TabBar active="club" />);
    expect(await screen.findByText('2')).toBeTruthy();
  });

  it('shows no badge on Alerts when nothing is unread', async () => {
    alertsUnreadCount = 0;
    render(<TabBar active="club" />);
    await waitFor(() => expect(screen.queryByText('0')).toBeNull());
    expect(screen.queryByText('0')).toBeNull();
  });

  it("composes the unread notification count into the Alerts tab's accessible name", async () => {
    alertsUnreadCount = 3;
    render(<TabBar active="club" />);
    expect(await screen.findByRole('button', { name: 'Alerts, 3 unread' })).toBeTruthy();
  });
});
