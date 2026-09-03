import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const fetchNotificationUnreadCount = vi.fn(async (): Promise<number> => 0);

vi.mock('./notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./notifications')>();
  return { ...actual, fetchNotificationUnreadCount: () => fetchNotificationUnreadCount() };
});

// Wrapped in a real `useEffect` keyed on the callback's identity, not called
// inline on every render: `(cb) => cb()` fires on every render, which the
// real hook never does, and would refire the fetch regardless of what this
// file is trying to pin down. See app/__tests__/tab-bar.test.tsx's identical
// mock.
vi.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// Two module-scoped constants, not a fresh object per render or per call:
// each represents one real `onAuthStateChange` event handing out a session
// object, and reusing SESSION_A across renders (rather than re-literaling it)
// is what makes "the mock swapped objects" distinguishable from "the mock is
// just sloppy." Both carry the same user id — this is a TOKEN_REFRESHED /
// tab-focus event, not an account switch.
const SESSION_A = { session: { user: { id: 'test-user' } }, loading: false };
const SESSION_B = { session: { user: { id: 'test-user' } }, loading: false };
const NO_SESSION = { session: null, loading: false };

let current: typeof SESSION_A | typeof NO_SESSION = SESSION_A;
vi.mock('./session', () => ({ useSession: () => current }));

import { notifyNotificationsRead, useNotificationsUnread } from './use-notifications-unread';

/** A probe rather than renderHook: this repo has no
 *  @testing-library/react-hooks, and the hook's whole contract is a plain
 *  value, which a one-line component reports perfectly well. */
function Probe() {
  const count = useNotificationsUnread();
  return <span data-testid="count">{count}</span>;
}

describe('useNotificationsUnread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current = SESSION_A;
  });

  it('resolves to 0 with no session', async () => {
    current = NO_SESSION;
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(fetchNotificationUnreadCount).not.toHaveBeenCalled();
  });

  it('calls fetchNotificationUnreadCount and returns its result when signed in', async () => {
    fetchNotificationUnreadCount.mockResolvedValueOnce(5);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('5'));
    expect(fetchNotificationUnreadCount).toHaveBeenCalledTimes(1);
  });

  it('does not refetch when a new session object arrives for the same user', async () => {
    const { rerender } = render(<Probe />);
    await waitFor(() => expect(fetchNotificationUnreadCount).toHaveBeenCalledTimes(1));

    // Simulate a TOKEN_REFRESHED-style event: a new Session object, same
    // user id.
    current = SESSION_B;
    rerender(<Probe />);

    // Give any spurious effect a chance to fire before asserting it didn't.
    await waitFor(() => expect(screen.getByTestId('count')).toBeTruthy());
    expect(fetchNotificationUnreadCount).toHaveBeenCalledTimes(1);
  });

  // app/alerts.tsx calls this right after markNotificationsRead() succeeds,
  // to clear a mounted badge with no real focus event to trigger the
  // useFocusEffect above -- see that screen's own comment on `load`. This
  // proves the pub/sub half of the contract on its own, independent of that
  // screen's markup.
  it('refetches a mounted instance when notifyNotificationsRead is called, with no focus event', async () => {
    fetchNotificationUnreadCount.mockResolvedValueOnce(3);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    expect(fetchNotificationUnreadCount).toHaveBeenCalledTimes(1);

    fetchNotificationUnreadCount.mockResolvedValueOnce(0);
    notifyNotificationsRead();

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(fetchNotificationUnreadCount).toHaveBeenCalledTimes(2);
  });

  // A listener that has already unmounted (e.g. TabBar on a screen the
  // member has since left) must not be notified -- its cleanup removes it
  // from the module-scoped `listeners` set on unmount.
  it('does not refetch an unmounted instance', async () => {
    fetchNotificationUnreadCount.mockResolvedValueOnce(3);
    const { unmount } = render(<Probe />);
    await waitFor(() => expect(fetchNotificationUnreadCount).toHaveBeenCalledTimes(1));
    unmount();

    notifyNotificationsRead();

    // Nothing async to await for a negative assertion -- a flush of pending
    // microtasks is enough to let a spurious call land if the cleanup didn't
    // run.
    await Promise.resolve();
    expect(fetchNotificationUnreadCount).toHaveBeenCalledTimes(1);
  });
});
