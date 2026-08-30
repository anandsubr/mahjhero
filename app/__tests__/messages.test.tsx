import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import MessagesScreen from '../messages/index';
import type { ThreadListRow } from '../../lib/messages';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/messages',
  // The real useFocusEffect (node_modules/expo-router/build/useFocusEffect.js)
  // wraps the callback in a React.useEffect keyed on
  // [effect, navigation, optionalNavigation] and fires it from a `focus`
  // listener (or once on mount when already focused) — it never re-runs
  // just because the screen re-rendered. A bare `(cb) => cb()` mock invokes
  // the callback on every render instead, which let load()'s own setState
  // calls re-trigger load() and forced messages/index.tsx to grow a guard
  // purely to survive that double-fire. Keying this on the callback's own
  // identity is the closest a lightweight mock gets to the real semantics
  // without wiring up navigation events: it fires on mount, and again only
  // when the memoized callback identity actually changes. Do not simplify
  // this back to `(cb) => cb()` — that reintroduces the per-render refire.
  useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
}));

// A module-scoped constant, not a literal inside the hook, so the returned
// object is the same reference on every render — matching the real
// lib/session.tsx, where useSession() reads from Context and only gets a
// new object when the Provider itself re-renders, not on every consumer
// render. messages/index.tsx's useFocusEffect callback depends on
// `[session, load]`; a fresh `session` object per render would make that
// callback's identity churn every render too, defeating the point of the
// honest useFocusEffect mock above.
const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const fetchMyThreads = vi.fn();
const openThreadForClub = vi.fn();
// TabBar (carried by this screen) now calls `useUnreadCounts`, which reaches
// this — added to the existing factory below rather than a second
// `vi.mock('../../lib/messages', …)`, since only one survives hoisting.
const fetchUnreadCounts = vi.fn(async () => []);

vi.mock('../../lib/messages', async () => {
  // The pure helpers are covered in lib/messages.test.ts. Mocking them here
  // would only let this screen sort and section in ways the real ones never
  // produce.
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    fetchMyThreads: (...a: unknown[]) => fetchMyThreads(...a),
    openThreadForClub: (...a: unknown[]) => openThreadForClub(...a),
    fetchUnreadCounts: () => fetchUnreadCounts(),
  };
});

function row(over: Partial<ThreadListRow> = {}): ThreadListRow {
  return {
    thread_id: 't1',
    kind: 'club',
    title: 'Everyone at Riverside',
    club_id: 'c1',
    club_name: 'Riverside',
    member_count: 42,
    last_body: 'See you Tuesday',
    last_author: 'Alice Ng',
    last_is_announcement: false,
    last_message_at: '2026-08-25T10:00:00Z',
    unread: 0,
    event_id: null,
    event_starts_at: null,
    event_timezone: 'America/New_York',
    ...over,
  };
}

const GAME = row({
  thread_id: 't2',
  kind: 'game',
  title: 'Tuesday Night',
  event_id: 'e1',
  event_starts_at: '2026-08-27T22:00:00Z',
  last_message_at: '2026-08-26T09:00:00Z',
});

const DIRECT = row({
  thread_id: 't3',
  kind: 'direct',
  title: 'Bob Reyes',
  club_id: null,
  club_name: null,
  last_message_at: '2026-08-24T09:00:00Z',
});

describe('messages list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMyThreads.mockResolvedValue([row(), GAME, DIRECT]);
    openThreadForClub.mockResolvedValue({ id: 't1', error: null });
  });

  // The club thread heads the list regardless of recency -- GAME's own
  // last_message_at (Aug 26) is newer than the club thread's (Aug 25), and
  // it still sorts second. Pinning clubs at the top is what makes the old
  // "Recent | By club" sort control redundant: it already does the grouping
  // "By club" did and the recency "Recent" did, in the one order.
  it('lists the club thread first, then everything else newest first', async () => {
    render(<MessagesScreen />);
    const titles = await screen.findAllByText(
      /Everyone at Riverside|Tuesday Night|Bob Reyes/,
    );
    expect(titles.map((n) => n.textContent)).toEqual([
      'Everyone at Riverside',
      'Tuesday Night',
      'Bob Reyes',
    ]);
  });

  // The sort control this screen used to carry is gone entirely -- pinning
  // clubs at the top does both jobs it did, so there is nothing left for it
  // to choose between.
  it('carries no Recent/By club sort control', async () => {
    render(<MessagesScreen />);
    await screen.findByText('Everyone at Riverside');
    expect(screen.queryByText('Recent')).toBeNull();
    expect(screen.queryByText('By club')).toBeNull();
  });

  // "we could not ask" and "you have no conversations" are different claims,
  // and an empty state for a failed read tells the member something false.
  it('shows an error rather than an empty state when the load fails', async () => {
    fetchMyThreads.mockResolvedValueOnce(null);
    render(<MessagesScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText(/No conversations yet/)).toBeNull();
  });

  it('shows the empty state when there really is nothing', async () => {
    fetchMyThreads.mockResolvedValueOnce([]);
    render(<MessagesScreen />);
    expect(await screen.findByText(/No conversations yet/)).toBeTruthy();
  });

  // A club thread nobody has posted in has no id yet. Tapping it goes
  // through open_thread_for_club, which creates the row and returns the id.
  it('opens a never-used club thread through the RPC', async () => {
    fetchMyThreads.mockResolvedValueOnce([
      row({ thread_id: null, last_message_at: null, last_body: null, last_author: null }),
    ]);
    render(<MessagesScreen />);
    fireEvent.click(await screen.findByLabelText('Everyone at Riverside'));
    await waitFor(() => expect(openThreadForClub).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/messages/t1'));
  });

  it('navigates straight to a thread that already has an id', async () => {
    render(<MessagesScreen />);
    fireEvent.click(await screen.findByLabelText('Tuesday Night'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/messages/t2'));
    expect(openThreadForClub).not.toHaveBeenCalled();
  });

  it('surfaces a refusal from open_thread_for_club instead of navigating', async () => {
    fetchMyThreads.mockResolvedValueOnce([row({ thread_id: null })]);
    openThreadForClub.mockResolvedValueOnce({
      id: null,
      error: 'you are not a member of this club',
    });
    render(<MessagesScreen />);
    fireEvent.click(await screen.findByLabelText('Everyone at Riverside'));
    expect(
      await screen.findByText('you are not a member of this club'),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  // open()'s own guard reads `opening` from the render closure, which is
  // blind to a second activation landing before that render has committed —
  // a queued tap, a screen-reader activation, a native double-tap. Firing
  // both clicks inside one `act()` reproduces exactly that: neither click
  // gets a re-render in between, so both run against the same stale
  // `opening === false` closure. See the identical guard in
  // app/clubs/index.tsx and app/friends.tsx.
  it('opens a club thread only once when tapped twice before openThreadForClub resolves', async () => {
    fetchMyThreads.mockResolvedValueOnce([row({ thread_id: null })]);
    let resolveOpen: (v: { id: string | null; error: string | null }) => void;
    openThreadForClub.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOpen = resolve;
      }),
    );
    render(<MessagesScreen />);
    const target = await screen.findByLabelText('Everyone at Riverside');

    act(() => {
      fireEvent.click(target);
      fireEvent.click(target);
    });

    resolveOpen!({ id: 't1', error: null });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/messages/t1'));
    expect(openThreadForClub).toHaveBeenCalledTimes(1);
  });

  it('reaches the compose screen', async () => {
    render(<MessagesScreen />);
    fireEvent.click(await screen.findByLabelText('New'));
    expect(push).toHaveBeenCalledWith('/messages/new');
  });
});
