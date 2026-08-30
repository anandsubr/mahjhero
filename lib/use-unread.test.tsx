import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const fetchUnreadCounts = vi.fn(
  async (): Promise<{ club_id: string | null; unread: number }[]> => [],
);

vi.mock('./messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./messages')>();
  return { ...actual, fetchUnreadCounts: () => fetchUnreadCounts() };
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

let current: typeof SESSION_A = SESSION_A;
vi.mock('./session', () => ({ useSession: () => current }));

import { useUnreadCounts } from './use-unread';

/** A probe rather than renderHook: this repo has no
 *  @testing-library/react-hooks, and the hook's whole contract is a plain
 *  value, which a one-line component reports perfectly well. */
function Probe() {
  const counts = useUnreadCounts();
  return <span data-testid="total">{counts.total}</span>;
}

describe('useUnreadCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current = SESSION_A;
  });

  // The regression this file exists to catch: lib/session.tsx hands out a
  // fresh Session object on every onAuthStateChange, TOKEN_REFRESHED
  // included, which fires roughly hourly and on web tab focus. A hook keyed
  // on the session object itself — rather than on the user id it carries —
  // treats that as a reason to refetch, hitting the RPC for a value that
  // only actually changes on a real account switch. This is the same trap
  // lib/use-viewer.ts and app/profile.tsx (and, before them, app/friends.tsx)
  // document and were fixed for.
  it('does not refetch when a new session object arrives for the same user', async () => {
    const { rerender } = render(<Probe />);
    await waitFor(() => expect(fetchUnreadCounts).toHaveBeenCalledTimes(1));

    // Simulate a TOKEN_REFRESHED-style event: a new Session object, same
    // user id.
    current = SESSION_B;
    rerender(<Probe />);

    // Give any spurious effect a chance to fire before asserting it didn't.
    await waitFor(() => expect(screen.getByTestId('total')).toBeTruthy());
    expect(fetchUnreadCounts).toHaveBeenCalledTimes(1);
  });
});
