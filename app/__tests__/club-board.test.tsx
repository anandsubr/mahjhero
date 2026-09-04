import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ClubBoardScreen from '../messages/club/[threadId]/index';
import { glyphForClub } from '../../lib/dashboard';

const push = vi.fn();

// Forwards to, rather than replaces, the identity-keyed `useEffect` double
// below -- a bare `vi.fn()` swapped in for `useFocusEffect` would drop the
// mount-time call every other test here relies on to load the board at
// all. Capturing every call lets one test re-invoke the LATEST registered
// callback by hand, standing in for a real refocus: expo-router's actual
// hook re-fires on every focus event regardless of the callback's
// identity, which this identity-keyed test double cannot do on its own
// (see that test's own comment for why).
const useFocusEffectSpy = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/messages/club/t1',
  useLocalSearchParams: () => ({ threadId: 't1' }),
  // A bare `(cb) => cb()` fires on every render, which the real hook never
  // does -- see app/__tests__/messages.test.tsx's identical comment. Keying
  // this on the callback's own identity is the closest a lightweight mock
  // gets to the real semantics without wiring up navigation events.
  useFocusEffect: (cb: () => void) => {
    useFocusEffectSpy(cb);
    useEffect(cb, [cb]);
  },
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
// re-test the hook itself through an extra layer; a stub is enough to prove
// this screen wires the hook up without re-verifying the hook.
//
// A module-scoped spy the factory FORWARDS to, not a bare `vi.fn()` inside
// it: a stub nothing can reach is a stub nothing can assert on, and deleting
// the hook call from the screen entirely would have left every test in this
// file green. app/__tests__/club-post.test.tsx does it this way for the same
// reason.
const useThreadRealtime = vi.fn();
vi.mock('../../lib/use-thread-realtime', () => ({
  useThreadRealtime: (...a: unknown[]) => useThreadRealtime(...a),
}));

const fetchClubPosts = vi.fn();
const markPostRead = vi.fn();
// The New post button's `clubId` query param comes from this, not from
// `fetch_club_posts`' own rows (ClubPost carries no club_id -- every row it
// returns already belongs to this one thread).
const fetchThread = vi.fn();
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
    fetchThread: (...a: unknown[]) => fetchThread(...a),
    fetchUnreadCounts: () => fetchUnreadCounts(),
  };
});

// TabBar also now calls useNotificationsUnread for its Alerts badge --
// without this it falls through to a real, unmocked RPC call.
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

describe('the club board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchUnreadCounts.mockResolvedValue([]);
    fetchThread.mockResolvedValue({ id: 't1', club_id: 'c1' });
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

  // Task 10 deliberately shipped the board with no way to start a post --
  // this route did not exist yet. This is that control finally wired up.
  it('offers a New post control that carries this thread and its club to the compose screen', async () => {
    fetchClubPosts.mockResolvedValue([]);
    render(<ClubBoardScreen />);
    await waitFor(() => expect(screen.getByLabelText('New post')).toBeTruthy());
    // The button renders before `fetchThread`'s own promise settles (it is
    // deliberately not gated on `ready` -- see the screen's own comment),
    // so the href it carries is a moving target until `clubId` lands.
    // Retrying the click inside `waitFor` catches it once state settles,
    // rather than asserting against whichever href happened to be current
    // the instant this test clicked.
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText('New post'));
      expect(push).toHaveBeenCalledWith('/messages/club/new?threadId=t1&clubId=c1');
    });
  });

  // Nothing at any level covered where a board row actually goes -- the
  // screen could have pushed anywhere, or nowhere, and stayed green.
  it('opens the post a row names, on this board', async () => {
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
    fireEvent.click(await screen.findByLabelText(/Anyone free Thursday\?/));
    expect(push).toHaveBeenCalledWith('/messages/club/t1/p1');
  });

  // The board subscribes to its THREAD, not to any one post -- the same
  // channel every screen on this thread shares. Asserted rather than left to
  // a stub nobody looks at: without this, deleting the hook call from the
  // screen leaves the board permanently stale and every test here passing.
  it('subscribes to the thread so a new post appears without a reopen', async () => {
    fetchClubPosts.mockResolvedValue([]);
    render(<ClubBoardScreen />);
    await waitFor(() =>
      expect(useThreadRealtime).toHaveBeenCalledWith('t1', 'me', expect.any(Function)),
    );
  });

  it('refetches the board when the subscription fires', async () => {
    fetchClubPosts.mockResolvedValue([]);
    render(<ClubBoardScreen />);
    await waitFor(() => expect(fetchClubPosts).toHaveBeenCalledTimes(1));
    const onInsert = useThreadRealtime.mock.calls[0][2] as () => void;
    await act(async () => {
      onInsert();
      await Promise.resolve();
    });
    expect(fetchClubPosts).toHaveBeenCalledTimes(2);
  });

  // `useFocusEffect`, not a plain `useEffect`: opening a post pushes a
  // screen ON TOP of the board rather than unmounting it, so a mount-only
  // effect never runs again, and `markPostRead` (fired from the post
  // screen) writes `post_reads`, which is outside the realtime
  // publication -- nothing else would tell this screen a dot it drew is
  // now stale. A plain `useEffect(load, [threadId])` leaves every other
  // test in this file green, because none of them simulate a SECOND focus
  // -- they only exercise the mount-time fetch every effect flavor shares.
  //
  // `mockResolvedValueOnce` twice, not `mockResolvedValue` once, because a
  // single resolved value's array keeps the same identity across calls,
  // and `setPosts(rows)` on an identical array bails out of re-rendering --
  // a real change under a stable reference would look, to this test, like
  // no refetch happened at all.
  it('refetches the board on refocus, so a post read elsewhere clears its dot', async () => {
    fetchClubPosts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'p2',
          author_id: 'a2',
          author_name: 'Bob Reyes',
          body: 'New post while you were away',
          subject: null,
          is_announcement: false,
          created_at: '2026-08-30T11:00:00.000Z',
          reply_count: 0,
          last_reply_at: null,
          last_activity_at: '2026-08-30T11:00:00.000Z',
          unread: 0,
        },
      ]);
    render(<ClubBoardScreen />);
    await waitFor(() => expect(fetchClubPosts).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();

    // The navigation event a real refocus delivers, played by hand: the
    // registered callback's identity has not changed (`load` is stable on
    // `threadId`), so nothing about a render triggers this on its own --
    // only calling it, the way expo-router's subscription would, does.
    //
    // TabBar's own `useUnreadCounts` also calls `useFocusEffect` (Screen
    // renders TabBar), so the spy sees more than one registrant. A real
    // refocus reaches every one of them, not just the board's -- de-duped
    // by identity (each is a stable `useCallback`) and invoked all
    // together is the faithful replay, not a guess at which index is
    // "the board's".
    expect(useFocusEffectSpy).toHaveBeenCalled();
    const callbacks = Array.from(
      new Set(useFocusEffectSpy.mock.calls.map((c) => c[0] as () => void)),
    );
    await act(async () => {
      callbacks.forEach((cb) => cb());
      await Promise.resolve();
    });

    await waitFor(() => expect(fetchClubPosts).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('New post while you were away')).toBeTruthy();
  });

  it('still offers New post when fetchThread cannot say which club this is', async () => {
    fetchClubPosts.mockResolvedValue([]);
    fetchThread.mockResolvedValue(null);
    render(<ClubBoardScreen />);
    await waitFor(() => expect(screen.getByLabelText('New post')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('New post'));
    expect(push).toHaveBeenCalledWith('/messages/club/new?threadId=t1&clubId=');
  });

  // The old control was a full-width Button reading "New post" as its own
  // visible label, between the header and the post list. The replacement is
  // an icon-only top-right PlusButton with the same accessible name -- same
  // control, same destination, different chrome. `screen.queryByText` (not
  // `queryByLabelText`) is the right check for "no visible text of its own":
  // PlusButton's accessibilityLabel becomes the accessible name via
  // react-native-web's aria-label, which testing-library's `getByText`
  // never matches on, so this only passes once the visible "New post" text
  // node the old Button rendered as a CHILD is actually gone.
  it('moves New post into a top-right + button, off its own full-width row', async () => {
    fetchClubPosts.mockResolvedValue([]);
    render(<ClubBoardScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'New post' })).toBeTruthy(),
    );
    expect(screen.queryByText('New post')).toBeNull();
  });

  // The board shipped with no header at all -- a member who tapped in had
  // no way to tell which club they had landed on, and no way back except
  // the tab bar. This is the fix, built to the same iOS Messages convention
  // app/messages/[threadId].tsx already carries.
  describe('header', () => {
    beforeEach(() => {
      fetchThread.mockResolvedValue({
        id: 't1',
        club_id: 'c1',
        event_id: null,
        title: null,
        clubs: { name: 'Cedar Falls Mah Jongg', timezone: 'America/New_York' },
        events: null,
        thread_members: [],
      });
      fetchClubPosts.mockResolvedValue([]);
    });

    it("shows the club's name once the thread has loaded", async () => {
      render(<ClubBoardScreen />);
      expect(await screen.findByText('Cedar Falls Mah Jongg')).toBeTruthy();
      expect(screen.getByTestId('thread-header-avatar-club')).toBeTruthy();
    });

    // Task 8/9's `asTile` treatment (components/ThreadAvatar.tsx) draws a
    // mahjong tile instead of the plain circle -- but this screen keeps its
    // own explicit `testID={`thread-header-avatar-${kind}`}` at the call
    // site (unlike components/DashboardHeader.tsx's callers, which omit
    // `testID` and so fall back to ThreadAvatar's own default
    // `thread-avatar-club-tile`), so that testID alone can't distinguish
    // tile mode from the plain circle -- both branches render it identically
    // when an explicit testID is passed. Reusing app/__tests__/
    // nav-glyph-parity.test.tsx's own idiom instead: look for the glyph
    // MahjongTile itself renders (`glyph-<suit>`, components/MahjongTile.tsx)
    // inside the avatar container, which only exists in tile mode.
    it('shows the club as a mahjong tile', async () => {
      render(<ClubBoardScreen />);
      const tile = await screen.findByTestId('thread-header-avatar-club');
      expect(within(tile).getByTestId(`glyph-${glyphForClub('c1')}`)).toBeTruthy();
    });

    it('shows a back chevron, distinctly named from the Messages tab, that returns to /messages', async () => {
      render(<ClubBoardScreen />);
      await screen.findByText('Cedar Falls Mah Jongg');
      // Still exactly one control literally named "Messages" -- the tab
      // bar's own tab -- so the two can never collapse into the same
      // control.
      expect(screen.getAllByRole('button', { name: 'Messages' })).toHaveLength(1);
      fireEvent.click(screen.getByLabelText('Back to Messages'));
      expect(push).toHaveBeenCalledWith('/messages');
    });

    // The pill no longer navigates -- matching app/messages/club/new.tsx's
    // own inert pill (a control that looks tappable and does nothing is
    // worse than one that plainly isn't interactive).
    it('renders the club pill as a plain label, not a button that could navigate away', async () => {
      render(<ClubBoardScreen />);
      await screen.findByText('Cedar Falls Mah Jongg');
      expect(
        screen.queryByRole('button', { name: /Cedar Falls Mah Jongg/ }),
      ).toBeNull();
    });

    // A half-built header -- a pill with no name in it -- would tell a
    // member something false. The board's own posts must not disappear
    // just because this best-effort read failed.
    it('renders only the back chevron, not a half-built pill, when the thread cannot be read -- and still shows the posts', async () => {
      fetchThread.mockResolvedValue(null);
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
      await screen.findByText('Anyone free Thursday?');
      expect(screen.getByLabelText('Back to Messages')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /view club/ })).toBeNull();
      expect(screen.queryByTestId('thread-header-avatar-club')).toBeNull();
    });
  });
});
