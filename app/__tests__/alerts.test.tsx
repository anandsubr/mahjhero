import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AlertsScreen from '../alerts';
import type { NotificationRow } from '../../lib/notifications';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, back: vi.fn() }),
  usePathname: () => '/alerts',
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire this screen's own
  // fetch (and TabBar's `useUnreadCounts`) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// Module-scoped constant, not a fresh object per render: TabBar's badge
// reads `useSession` too (via `useUnreadCounts`), and a fresh object here
// breaks the referential stability its `useCallback([session])` depends on,
// refiring the fetch on every render.
const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

// TabBar calls `useUnreadCounts`, which reaches `fetchUnreadCounts`. Spread
// `actual` rather than replacing the module outright: TabBar also calls
// `unreadSuffix`, a pure helper covered by lib/messages.test.ts -- only
// `fetchUnreadCounts` needs to be a controllable double here.
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: vi.fn(async () => []),
  };
});

const fetchMyNotifications = vi.fn();
const markNotificationsRead = vi.fn();

vi.mock('../../lib/notifications', async () => {
  // describeNotification is pure and already covered in
  // lib/notifications.test.ts -- mocking it would only let this screen
  // render text the real one never produces.
  const actual = await vi.importActual<typeof import('../../lib/notifications')>(
    '../../lib/notifications',
  );
  return {
    describeNotification: actual.describeNotification,
    fetchMyNotifications: (...a: unknown[]) => fetchMyNotifications(...a),
    markNotificationsRead: (...a: unknown[]) => markNotificationsRead(...a),
  };
});

const BOOKED_BY_FRIEND: NotificationRow = {
  id: 'n1',
  kind: 'booked_by_friend',
  payload: {},
  club_id: 'club-1',
  club_name: 'Riverside Mah Jongg',
  event_id: 'event-1',
  event_title: 'Thursday Mahjong',
  event_starts_at: '2026-09-03T23:00:00.000Z',
  club_timezone: 'America/New_York',
  table_label: null,
  actor_name: 'Ada',
  broadcast_subject: null,
  broadcast_body: null,
  created_at: '2026-09-01T12:00:00.000Z',
};

describe('alerts screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMyNotifications.mockResolvedValue([]);
    markNotificationsRead.mockResolvedValue({ error: null });
  });

  it('shows the dashed empty card when there are no notifications', async () => {
    render(<AlertsScreen />);
    expect(await screen.findByText(/No notifications yet/)).toBeTruthy();
  });

  // "we could not ask" and "you have no notifications" are different claims.
  // An empty state for a failed read tells the member something false about
  // themselves.
  it('shows an error rather than the empty card when the load fails', async () => {
    fetchMyNotifications.mockResolvedValueOnce(null);
    render(<AlertsScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText(/No notifications yet/)).toBeNull();
  });

  it("renders a row's headline and detail text", async () => {
    fetchMyNotifications.mockResolvedValueOnce([BOOKED_BY_FRIEND]);
    render(<AlertsScreen />);
    expect(await screen.findByText('You have a seat')).toBeTruthy();
    expect(
      screen.getByText(/Ada booked you in for Thursday Mahjong/),
    ).toBeTruthy();
  });

  it('navigates to the notification href on tap', async () => {
    fetchMyNotifications.mockResolvedValueOnce([BOOKED_BY_FRIEND]);
    render(<AlertsScreen />);
    fireEvent.click(await screen.findByText('You have a seat'));
    expect(push).toHaveBeenCalledWith('/clubs/club-1/events/event-1');
  });

  it('marks notifications read once the load succeeds', async () => {
    fetchMyNotifications.mockResolvedValueOnce([BOOKED_BY_FRIEND]);
    render(<AlertsScreen />);
    await screen.findByText('You have a seat');
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(1));
  });

  it('does not mark read when the load fails', async () => {
    fetchMyNotifications.mockResolvedValueOnce(null);
    render(<AlertsScreen />);
    await screen.findByText(/Could not reach MahjHero/);
    expect(markNotificationsRead).not.toHaveBeenCalled();
  });

  it('carries the tab bar with Alerts marked', async () => {
    render(<AlertsScreen />);
    await screen.findByText(/No notifications yet/);
    expect(
      screen.getByRole('button', { name: 'Alerts' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('false');
  });
});
