import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ClubBoardScreen from '../messages/club/[threadId]';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/messages/club/t1',
  useLocalSearchParams: () => ({ threadId: 't1' }),
  // A bare `(cb) => cb()` fires on every render, which the real hook never
  // does -- see app/__tests__/messages.test.tsx's identical comment. Keying
  // this on the callback's own identity is the closest a lightweight mock
  // gets to the real semantics without wiring up navigation events.
  useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
}));

// A module-scoped constant, not a literal inside the hook: the same
// referential-stability requirement app/__tests__/messages.test.tsx and
// app/__tests__/thread.test.tsx both record for their own useSession mocks.
const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

// The board's own realtime subscription is lib/use-thread-realtime.ts,
// extracted in Task 9 and covered by its own unit tests
// (lib/use-thread-realtime.test.ts). Re-deriving the full postgres_changes
// channel double app/__tests__/thread.test.tsx builds for it would only
// re-test the hook itself through an extra layer; a no-op stub is enough to
// prove this screen wires the hook up without re-verifying the hook.
vi.mock('../../lib/use-thread-realtime', () => ({
  useThreadRealtime: vi.fn(),
}));

const fetchClubPosts = vi.fn();
const markPostRead = vi.fn();
// TabBar (carried by this screen via Screen's `tabBar` prop) calls
// useUnreadCounts, which reaches this -- the same reason every other screen
// test that renders TabBar mocks it (see app/__tests__/messages.test.tsx).
const fetchUnreadCounts = vi.fn(async () => []);

vi.mock('../../lib/messages', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    fetchClubPosts: (...a: unknown[]) => fetchClubPosts(...a),
    markPostRead: (...a: unknown[]) => markPostRead(...a),
    fetchUnreadCounts: () => fetchUnreadCounts(),
  };
});

describe('the club board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchUnreadCounts.mockResolvedValue([]);
  });

  it('lists posts', async () => {
    fetchClubPosts.mockResolvedValue([
      {
        id: 'p1',
        author_id: 'a1',
        author_name: 'Alice Chen',
        body: 'Anyone free Thursday?',
        subject: null,
        is_announcement: false,
        created_at: '2026-08-30T10:00:00.000Z',
        reply_count: 0,
        last_reply_at: null,
        last_activity_at: '2026-08-30T10:00:00.000Z',
        unread: 0,
      },
    ]);
    render(<ClubBoardScreen />);
    await waitFor(() =>
      expect(screen.getByText('Anyone free Thursday?')).toBeTruthy(),
    );
  });

  it('says so when the board is empty rather than showing a blank screen', async () => {
    fetchClubPosts.mockResolvedValue([]);
    render(<ClubBoardScreen />);
    await waitFor(() =>
      expect(screen.getByText(/Nothing here yet/)).toBeTruthy(),
    );
  });

  it('reports a failed load as a failure, not as an empty board', async () => {
    // lib/ never rejects: null means "we could not ask", [] means "there is
    // nothing". Conflating them tells a member something false.
    fetchClubPosts.mockResolvedValue(null);
    render(<ClubBoardScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  // Opening the board is not reading its posts -- mark_post_read fires from
  // the post screen (Task 11), which is what lets reading one announcement
  // leave every other post's dot alone. The board itself must never call it.
  it('does not mark anything read just by being opened', async () => {
    fetchClubPosts.mockResolvedValue([
      {
        id: 'p1',
        author_id: 'a1',
        author_name: 'Alice Chen',
        body: 'Anyone free Thursday?',
        subject: null,
        is_announcement: false,
        created_at: '2026-08-30T10:00:00.000Z',
        reply_count: 0,
        last_reply_at: null,
        last_activity_at: '2026-08-30T10:00:00.000Z',
        unread: 2,
      },
    ]);
    render(<ClubBoardScreen />);
    await waitFor(() =>
      expect(screen.getByText('Anyone free Thursday?')).toBeTruthy(),
    );
    expect(markPostRead).not.toHaveBeenCalled();
  });
});
