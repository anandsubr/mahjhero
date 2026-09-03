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
// TabBar itself now also reaches this module, via `useNotificationsUnread`
// -> `fetchNotificationUnreadCount` -- the same reason `fetchUnreadCounts`
// is doubled above for `useUnreadCounts`. Without this, TabBar's own
// fetch call falls through to the real, unmocked implementation. Hoisted to
// module scope (not left inline in the factory below) so individual tests
// can control what each call resolves to -- see the badge-clearing test.
const fetchNotificationUnreadCount = vi.fn(async () => 0);

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
    fetchNotificationUnreadCount: () => fetchNotificationUnreadCount(),
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

  // The one deliberately novel behavior on this screen: every other date in
  // this app renders in the CLUB's timezone (lib/events.ts's
  // formatEventWhen), but a notification's timestamp renders in the
  // DEVICE's own local zone instead -- no `timeZone` override. This repo's
  // suite runs pinned to TZ=America/New_York (see the `test` script).
  //
  // The fixture's `club_timezone` is deliberately overridden to
  // America/Los_Angeles here -- NOT America/New_York, which the shared
  // BOOKED_BY_FRIEND fixture above uses and which would make a club-timezone
  // regression invisible (device and club zone would coincide). And
  // `created_at` is chosen to cross the UTC/America-New-York day boundary:
  // 2026-09-02T02:30:00.000Z is Wed 2:30am in UTC, Tue 10:30pm in
  // America/New_York (device, EDT, UTC-4 in September), and Tue 7:30pm in
  // America/Los_Angeles (the row's own, wrong, club_timezone) -- three
  // different renderings, so this one assertion catches a regression to
  // either UTC or club_timezone, not only one of them. Expected string
  // computed the same way `formatReceivedAt` computes it
  // (Intl.DateTimeFormat, 'en-GB', weekday/day/month/hour/minute, hour12, no
  // timeZone key).
  it("renders the notification's timestamp in the device's local timezone, not UTC or the club's own", async () => {
    fetchMyNotifications.mockResolvedValueOnce([
      {
        ...BOOKED_BY_FRIEND,
        club_timezone: 'America/Los_Angeles',
        created_at: '2026-09-02T02:30:00.000Z',
      },
    ]);
    render(<AlertsScreen />);
    expect(await screen.findByText('Tue 1 Sept, 10:30 pm')).toBeTruthy();
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

  // TabBar (rendered inside this very screen's tree) fetches its badge count
  // as a child effect, before this screen's own load() has even called
  // markNotificationsRead() -- so the badge's FIRST fetch always sees the
  // stale, pre-read count. Nothing about staying on this screen fires a real
  // focus event, so without notifyNotificationsRead() the badge would only
  // ever clear on a navigate-away-and-back. This test never triggers a
  // rerender or refocus itself -- the badge dropping its "unread" suffix has
  // to come from the pub/sub alone.
  it('clears the alerts badge once mark-read succeeds, with no refocus', async () => {
    fetchMyNotifications.mockResolvedValueOnce([BOOKED_BY_FRIEND]);
    fetchNotificationUnreadCount.mockResolvedValueOnce(3).mockResolvedValueOnce(0);

    // markNotificationsRead is held open rather than left to resolve on its
    // own tick: with everything else mocked to resolve immediately, its
    // real (fast) resolution and the badge's own initial fetch would settle
    // in the same microtask flush, and this test would never observe the
    // "3 unread" state in between -- only ever the end state. Holding this
    // one promise open gives a deterministic window to assert it.
    let resolveMarkRead: (result: { error: string | null }) => void;
    markNotificationsRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMarkRead = resolve;
        }),
    );

    render(<AlertsScreen />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alerts, 3 unread' })).toBeTruthy(),
    );

    resolveMarkRead!({ error: null });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Alerts' })).toBeTruthy(),
    );
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
