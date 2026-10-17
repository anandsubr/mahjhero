import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ClubBoardScreen from '../messages/club/[threadId]/index';
import { glyphForClub } from '../../lib/dashboard';
import type { FeedPost } from '../../lib/board';

const platform = vi.hoisted(() => ({ os: 'web' }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return platform.os;
      },
    },
    KeyboardAvoidingView: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="kav">{children}</div>
    ),
  };
});

const push = vi.fn();
const back = vi.fn();
const replace = vi.fn();
const canGoBack = vi.fn(() => true);

// Forwards to, rather than replaces, the identity-keyed `useEffect` double
// below. Capturing every call lets one test re-invoke the LATEST registered
// callback by hand, standing in for a real refocus: expo-router's actual
// hook re-fires on every focus event regardless of the callback's identity,
// which this identity-keyed test double cannot do on its own.
const useFocusEffectSpy = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back, replace, canGoBack }),
  usePathname: () => '/messages/club/t1',
  useLocalSearchParams: () => ({ threadId: 't1' }),
  // Keyed on the callback's identity -- the real hook re-runs when the
  // callback changes while focused, and never on a plain re-render.
  useFocusEffect: (cb: () => void) => {
    useFocusEffectSpy(cb);
    useEffect(cb, [cb]);
  },
}));

const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

// Stub the hook (covered by lib/use-thread-realtime.test.ts) through a spy,
// so a test can assert the board subscribes and fire its callback by hand.
const useThreadRealtime = vi.fn();
vi.mock('../../lib/use-thread-realtime', () => ({
  useThreadRealtime: (...a: unknown[]) => useThreadRealtime(...a),
}));

const markPostRead = vi.fn();
const fetchThread = vi.fn();
const postMessage = vi.fn();
vi.mock('../../lib/messages', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    markPostRead: (...a: unknown[]) => markPostRead(...a),
    fetchThread: (...a: unknown[]) => fetchThread(...a),
    postMessage: (...a: unknown[]) => postMessage(...a),
  };
});

const fetchClubFeed = vi.fn();
const togglePostHeart = vi.fn();
const loadFeedOrder = vi.fn();
const saveFeedOrder = vi.fn();
vi.mock('../../lib/board', async () => {
  const actual = await vi.importActual<typeof import('../../lib/board')>('../../lib/board');
  return {
    ...actual,
    fetchClubFeed: (...a: unknown[]) => fetchClubFeed(...a),
    togglePostHeart: (...a: unknown[]) => togglePostHeart(...a),
    loadFeedOrder: (...a: unknown[]) => loadFeedOrder(...a),
    saveFeedOrder: (...a: unknown[]) => saveFeedOrder(...a),
  };
});

const getSignedUrls = vi.fn();
vi.mock('../../lib/attachments', () => ({
  pickImages: vi.fn(),
  compressImage: vi.fn(),
  uploadAttachment: vi.fn(),
  getSignedUrls: (...a: unknown[]) => getSignedUrls(...a),
  MAX_ATTACHMENTS: 4,
}));

const fetchRoster = vi.fn();
vi.mock('../../lib/clubs', async () => {
  const actual = await vi.importActual<typeof import('../../lib/clubs')>('../../lib/clubs');
  return { ...actual, fetchRoster: (...a: unknown[]) => fetchRoster(...a) };
});

function post(id: string, over: Partial<FeedPost> = {}): FeedPost {
  return {
    id,
    authorId: 'a1',
    authorName: 'Alice Chen',
    authorRole: 'member',
    body: `Body of ${id}`,
    subject: null,
    isAnnouncement: false,
    createdAt: '2026-08-30T10:00:00.000Z',
    lastActivityAt: '2026-08-30T10:00:00.000Z',
    replyCount: 0,
    unread: false,
    heartCount: 0,
    heartedByMe: false,
    attachments: [],
    recentComments: [],
    ...over,
  };
}

/** A promise plus its resolver, for holding a call in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('the club board', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchThread.mockResolvedValue({ id: 't1', club_id: 'c1' });
    loadFeedOrder.mockResolvedValue('recent');
    saveFeedOrder.mockResolvedValue(undefined);
    getSignedUrls.mockResolvedValue({});
    fetchRoster.mockResolvedValue([{ profile_id: 'me', role: 'member', display_name: 'Me', skill_level: null }]);
    fetchClubFeed.mockResolvedValue([]);
  });

  it('captions the board and lists posts as post cards', async () => {
    fetchClubFeed.mockResolvedValue([post('p1', { body: 'Anyone free Thursday?', heartCount: 3 })]);
    render(<ClubBoardScreen />);
    expect(await screen.findByText('Anyone free Thursday?')).toBeTruthy();
    expect(screen.getByText('Everyone in the club sees posts here')).toBeTruthy();
    // PostCard's own heart pill and comment link.
    expect(screen.getByRole('button', { name: 'Heart this post' })).toBeTruthy();
    expect(screen.getByText('Comment')).toBeTruthy();
    expect(fetchClubFeed).toHaveBeenCalledWith('t1', 'recent', undefined, 30);
  });

  it('says so when the board is empty', async () => {
    render(<ClubBoardScreen />);
    expect(await screen.findByText('Nothing here yet. Start the first post.')).toBeTruthy();
  });

  it('reports a failed load as a failure, not as an empty board', async () => {
    fetchClubFeed.mockResolvedValue(null);
    render(<ClubBoardScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Nothing here yet. Start the first post.')).toBeNull();
  });

  it('does not mark anything read just by being opened', async () => {
    fetchClubFeed.mockResolvedValue([post('p1', { unread: true })]);
    render(<ClubBoardScreen />);
    await screen.findByText('Body of p1');
    expect(markPostRead).not.toHaveBeenCalled();
  });

  describe('sort', () => {
    it('defaults to Most recent and switches to Latest activity, refetching and remembering it', async () => {
      fetchClubFeed.mockResolvedValue([post('p1')]);
      render(<ClubBoardScreen />);
      await screen.findByText('Body of p1');
      expect(screen.getByText('Most recent')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Sort posts: Most recent' }));
      fireEvent.click(screen.getByRole('button', { name: 'Latest activity' }));
      await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledWith('t1', 'activity', undefined, 30));
      expect(saveFeedOrder).toHaveBeenCalledWith('activity');
      expect(await screen.findByRole('button', { name: 'Sort posts: Latest activity' })).toBeTruthy();
    });

    it('starts in the remembered order', async () => {
      loadFeedOrder.mockResolvedValue('activity');
      render(<ClubBoardScreen />);
      await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledWith('t1', 'activity', undefined, 30));
      expect(fetchClubFeed).not.toHaveBeenCalledWith('t1', 'recent', undefined, 30);
    });
  });

  describe('hearts', () => {
    it('fills the heart and bumps the count immediately, before the server answers', async () => {
      fetchClubFeed.mockResolvedValue([post('p1', { heartCount: 2 })]);
      const call = deferred<{ hearted: boolean | null; error: string | null }>();
      togglePostHeart.mockReturnValue(call.promise);
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Heart this post' }));
      const pill = screen.getByRole('button', { name: 'Remove your heart' });
      expect(within(pill).getByText('3')).toBeTruthy();
      await act(async () => call.resolve({ hearted: true, error: null }));
      expect(within(screen.getByRole('button', { name: 'Remove your heart' })).getByText('3')).toBeTruthy();
      expect(togglePostHeart).toHaveBeenCalledWith('p1');
    });

    it('rolls the heart and count back when the toggle fails', async () => {
      fetchClubFeed.mockResolvedValue([post('p1', { heartCount: 2 })]);
      togglePostHeart.mockResolvedValue({ hearted: null, error: 'nope' });
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Heart this post' }));
      await waitFor(() => expect(togglePostHeart).toHaveBeenCalled());
      const pill = await screen.findByRole('button', { name: 'Heart this post' });
      expect(within(pill).getByText('2')).toBeTruthy();
    });

    it('rolls an un-heart back too', async () => {
      fetchClubFeed.mockResolvedValue([post('p1', { heartCount: 1, heartedByMe: true })]);
      togglePostHeart.mockResolvedValue({ hearted: null, error: 'nope' });
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Remove your heart' }));
      await waitFor(() => expect(togglePostHeart).toHaveBeenCalled());
      const pill = await screen.findByRole('button', { name: 'Remove your heart' });
      expect(within(pill).getByText('1')).toBeTruthy();
    });

    it('ignores a second tap while the first toggle is in flight', async () => {
      fetchClubFeed.mockResolvedValue([post('p1', { heartCount: 0 })]);
      const call = deferred<{ hearted: boolean | null; error: string | null }>();
      togglePostHeart.mockReturnValue(call.promise);
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Heart this post' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove your heart' }));
      expect(togglePostHeart).toHaveBeenCalledTimes(1);
      await act(async () => call.resolve({ hearted: true, error: null }));
      const pill = screen.getByRole('button', { name: 'Remove your heart' });
      expect(within(pill).getByText('1')).toBeTruthy();
    });

    it('settles on the state the server reports', async () => {
      fetchClubFeed.mockResolvedValue([post('p1', { heartCount: 4 })]);
      // Server says "not hearted" (e.g. another device already toggled).
      togglePostHeart.mockResolvedValue({ hearted: false, error: null });
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Heart this post' }));
      await waitFor(() => expect(togglePostHeart).toHaveBeenCalled());
      const pill = await screen.findByRole('button', { name: 'Heart this post' });
      expect(within(pill).getByText('4')).toBeTruthy();
    });
  });

  describe('hearts vs a refresh landing mid-flight', () => {
    it('settles relative to the refreshed row, not the tap-time count', async () => {
      fetchClubFeed
        .mockResolvedValueOnce([post('p1', { heartCount: 2 })])
        // Read before the toggle committed: others hearted meanwhile (5), mine not yet.
        .mockResolvedValueOnce([post('p1', { heartCount: 5, heartedByMe: false })]);
      const call = deferred<{ hearted: boolean | null; error: string | null }>();
      togglePostHeart.mockReturnValue(call.promise);
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Heart this post' }));
      const onInsert = useThreadRealtime.mock.calls.at(-1)![2] as () => void;
      await act(async () => {
        onInsert();
      });
      await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledTimes(2));
      await act(async () => call.resolve({ hearted: true, error: null }));
      const pill = await screen.findByRole('button', { name: 'Remove your heart' });
      expect(within(pill).getByText('6')).toBeTruthy();
    });

    it('does not double-count when the refreshed row already has my heart', async () => {
      fetchClubFeed
        .mockResolvedValueOnce([post('p1', { heartCount: 2 })])
        .mockResolvedValueOnce([post('p1', { heartCount: 5, heartedByMe: true })]);
      const call = deferred<{ hearted: boolean | null; error: string | null }>();
      togglePostHeart.mockReturnValue(call.promise);
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Heart this post' }));
      const onInsert = useThreadRealtime.mock.calls.at(-1)![2] as () => void;
      await act(async () => {
        onInsert();
      });
      await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledTimes(2));
      await act(async () => call.resolve({ hearted: true, error: null }));
      const pill = await screen.findByRole('button', { name: 'Remove your heart' });
      expect(within(pill).getByText('5')).toBeTruthy();
    });

    it('on failure leaves a refreshed row alone when it no longer shows the optimistic state', async () => {
      fetchClubFeed
        .mockResolvedValueOnce([post('p1', { heartCount: 2 })])
        .mockResolvedValueOnce([post('p1', { heartCount: 7, heartedByMe: false })]);
      const call = deferred<{ hearted: boolean | null; error: string | null }>();
      togglePostHeart.mockReturnValue(call.promise);
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Heart this post' }));
      const onInsert = useThreadRealtime.mock.calls.at(-1)![2] as () => void;
      await act(async () => {
        onInsert();
      });
      await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledTimes(2));
      await act(async () => call.resolve({ hearted: null, error: 'nope' }));
      const pill = await screen.findByRole('button', { name: 'Heart this post' });
      expect(within(pill).getByText('7')).toBeTruthy();
    });
  });

  describe('paging', () => {
    const page1 = Array.from({ length: 30 }, (_, i) =>
      post(`p${i}`, {
        createdAt: `2026-08-30T10:${String(59 - i).padStart(2, '0')}:00.000Z`,
        lastActivityAt: `2026-08-31T10:${String(59 - i).padStart(2, '0')}:00.000Z`,
      }),
    );

    it('loads older posts from the last post and appends them without duplicates', async () => {
      fetchClubFeed
        .mockResolvedValueOnce(page1)
        // Overlaps on p29 (equal timestamp re-read) and adds p30.
        .mockResolvedValueOnce([page1[29], post('p30', { body: 'An older post' })]);
      render(<ClubBoardScreen />);
      await screen.findByText('Body of p0');
      fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
      expect(await screen.findByText('An older post')).toBeTruthy();
      expect(fetchClubFeed).toHaveBeenLastCalledWith('t1', 'recent', {
        at: page1[29].createdAt,
        id: 'p29',
      });
      expect(screen.getAllByText('Body of p29')).toHaveLength(1);
      // Fewer than a page came back: nothing older left.
      expect(screen.queryByRole('button', { name: 'Show older posts' })).toBeNull();
    });

    it('pages by last activity in Latest activity order', async () => {
      loadFeedOrder.mockResolvedValue('activity');
      fetchClubFeed.mockResolvedValueOnce(page1).mockResolvedValueOnce([]);
      render(<ClubBoardScreen />);
      await screen.findByText('Body of p0');
      fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
      await waitFor(() =>
        expect(fetchClubFeed).toHaveBeenLastCalledWith('t1', 'activity', {
          at: page1[29].lastActivityAt,
          id: 'p29',
        }),
      );
    });

    it('a realtime refetch keeps loaded older pages, requesting the loaded count', async () => {
      const older = post('p30', { body: 'An older post' });
      fetchClubFeed
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce([older])
        .mockResolvedValueOnce([...page1, older]);
      render(<ClubBoardScreen />);
      await screen.findByText('Body of p0');
      fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
      await screen.findByText('An older post');
      const onInsert = useThreadRealtime.mock.calls.at(-1)![2] as () => void;
      await act(async () => {
        onInsert();
      });
      await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledTimes(3));
      expect(fetchClubFeed).toHaveBeenLastCalledWith('t1', 'recent', undefined, 31);
      expect(screen.getByText('An older post')).toBeTruthy();
      expect(screen.getByText('Body of p0')).toBeTruthy();
    });

    it('a refocus keeps loaded older pages and Show older posts', async () => {
      const page2 = Array.from({ length: 30 }, (_, i) => post(`o${i}`, { body: `Older ${i}` }));
      fetchClubFeed
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce([...page1, ...page2]);
      render(<ClubBoardScreen />);
      await screen.findByText('Body of p0');
      fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
      await screen.findByText('Older 29');
      const latest = useFocusEffectSpy.mock.calls.at(-1)![0] as () => void;
      await act(async () => {
        latest();
      });
      await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledTimes(3));
      expect(fetchClubFeed).toHaveBeenLastCalledWith('t1', 'recent', undefined, 60);
      expect(screen.getByText('Older 29')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Show older posts' })).toBeTruthy();
    });

    it('past 100 loaded, a refresh asks for 100 and keeps the older tail', async () => {
      const pages = [0, 1, 2, 3].map((n) =>
        Array.from({ length: 30 }, (_, i) => post(`k${n * 30 + i}`, { body: `Post ${n * 30 + i}` })),
      );
      const all = pages.flat();
      fetchClubFeed
        .mockResolvedValueOnce(pages[0])
        .mockResolvedValueOnce(pages[1])
        .mockResolvedValueOnce(pages[2])
        .mockResolvedValueOnce(pages[3])
        // Refresh: a brand-new post on top, then the newest 99 already loaded.
        .mockResolvedValueOnce([post('new', { body: 'Brand new' }), ...all.slice(0, 99)]);
      render(<ClubBoardScreen />);
      await screen.findByText('Post 0');
      for (const last of ['Post 59', 'Post 89', 'Post 119']) {
        fireEvent.click(screen.getByRole('button', { name: 'Show older posts' }));
        await screen.findByText(last);
      }
      const onInsert = useThreadRealtime.mock.calls.at(-1)![2] as () => void;
      await act(async () => {
        onInsert();
      });
      await screen.findByText('Brand new');
      expect(fetchClubFeed).toHaveBeenLastCalledWith('t1', 'recent', undefined, 100);
      expect(screen.getByText('Post 119')).toBeTruthy();
      expect(screen.getAllByText('Post 50')).toHaveLength(1);
      const bodies = screen.getAllByText(/^(Brand new|Post 0|Post 119)$/).map((n) => n.textContent);
      expect(bodies).toEqual(['Brand new', 'Post 0', 'Post 119']);
    });

    it('hides Show older posts when the first page is short', async () => {
      fetchClubFeed.mockResolvedValue([post('p1')]);
      render(<ClubBoardScreen />);
      await screen.findByText('Body of p1');
      expect(screen.queryByRole('button', { name: 'Show older posts' })).toBeNull();
    });
  });

  describe('opening a post', () => {
    it('opens the post screen from its comments link', async () => {
      fetchClubFeed.mockResolvedValue([
        post('p1', {
          replyCount: 1,
          recentComments: [
            { id: 'r1', authorId: 'a2', authorName: 'Bob', body: 'Yes!', createdAt: '2026-08-30T11:00:00.000Z' },
          ],
        }),
      ]);
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByText('1 comment'));
      expect(push).toHaveBeenCalledWith('/messages/club/t1/p1');
    });

    it('opens the post screen from More on a long post', async () => {
      const long = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
      fetchClubFeed.mockResolvedValue([post('p1', { body: long })]);
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByText('More'));
      expect(push).toHaveBeenCalledWith('/messages/club/t1/p1');
    });
  });

  it('signs every loaded attachment in one batch', async () => {
    fetchClubFeed.mockResolvedValue([
      post('p1', { attachments: [{ id: 'x1', storage_path: 't1/a.jpg', width: 10, height: 10 }] }),
      post('p2', {
        attachments: [
          { id: 'x2', storage_path: 't1/b.jpg', width: 10, height: 10 },
          { id: 'x3', storage_path: 't1/c.jpg', width: 10, height: 10 },
        ],
      }),
    ]);
    render(<ClubBoardScreen />);
    await waitFor(() => expect(getSignedUrls).toHaveBeenCalled());
    expect(getSignedUrls).toHaveBeenCalledTimes(1);
    expect(getSignedUrls).toHaveBeenCalledWith(['t1/a.jpg', 't1/b.jpg', 't1/c.jpg']);
  });

  describe('composer', () => {
    it('pins the composer, and a new post reloads the feed with it first', async () => {
      fetchClubFeed
        .mockResolvedValueOnce([post('p1')])
        .mockResolvedValueOnce([post('p9', { body: 'Fresh post' }), post('p1')]);
      postMessage.mockResolvedValue({ id: 'p9', error: null });
      render(<ClubBoardScreen />);
      await screen.findByText('Body of p1');
      fireEvent.change(screen.getByPlaceholderText('Write to the club'), {
        target: { value: 'Fresh post' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Post' }));
      expect(await screen.findByText('Fresh post')).toBeTruthy();
      expect(fetchClubFeed).toHaveBeenCalledTimes(2);
      const bodies = screen.getAllByText(/^(Fresh post|Body of p1)$/).map((n) => n.textContent);
      expect(bodies).toEqual(['Fresh post', 'Body of p1']);
    });
  });

  describe('Announcement button', () => {
    it('shows organizers an Announcement button to the full composer', async () => {
      fetchRoster.mockResolvedValue([{ profile_id: 'me', role: 'co_organizer', display_name: 'Me', skill_level: null }]);
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Announcement' }));
      expect(push).toHaveBeenCalledWith('/messages/club/new?threadId=t1&clubId=c1');
      expect(fetchRoster).toHaveBeenCalledWith('c1');
    });

    it('does not show members an Announcement button', async () => {
      render(<ClubBoardScreen />);
      await screen.findByText('Nothing here yet. Start the first post.');
      await waitFor(() => expect(fetchRoster).toHaveBeenCalled());
      expect(screen.queryByRole('button', { name: 'Announcement' })).toBeNull();
    });
  });

  it('subscribes to the thread so a new post appears without a reopen', async () => {
    render(<ClubBoardScreen />);
    await waitFor(() =>
      expect(useThreadRealtime).toHaveBeenCalledWith('t1', 'me', expect.any(Function)),
    );
  });

  it('refetches the board when the subscription fires', async () => {
    render(<ClubBoardScreen />);
    await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledTimes(1));
    const onInsert = useThreadRealtime.mock.calls.at(-1)![2] as () => void;
    await act(async () => {
      onInsert();
      await Promise.resolve();
    });
    expect(fetchClubFeed).toHaveBeenCalledTimes(2);
  });

  // `useFocusEffect`, not a plain `useEffect`: opening a post pushes a
  // screen ON TOP of the board rather than unmounting it, so a mount-only
  // effect never runs again, and nothing else would tell this screen an
  // unread dot it drew is now stale.
  it('refetches the board on refocus, so a post read elsewhere clears its dot', async () => {
    fetchClubFeed
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([post('p2', { body: 'New post while you were away' })]);
    render(<ClubBoardScreen />);
    await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Nothing here yet/)).toBeTruthy();

    const latest = useFocusEffectSpy.mock.calls.at(-1)![0] as () => void;
    await act(async () => {
      latest();
      await Promise.resolve();
    });

    await waitFor(() => expect(fetchClubFeed).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('New post while you were away')).toBeTruthy();
  });

  it('keeps the header New post control, carrying this thread and its club', async () => {
    render(<ClubBoardScreen />);
    await waitFor(() => expect(screen.getByLabelText('New post')).toBeTruthy());
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText('New post'));
      expect(push).toHaveBeenCalledWith('/messages/club/new?threadId=t1&clubId=c1');
    });
  });

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
    });

    it("shows the club's name once the thread has loaded", async () => {
      render(<ClubBoardScreen />);
      expect(await screen.findByText('Cedar Falls Mah Jongg')).toBeTruthy();
      expect(screen.getByTestId('thread-header-avatar-club')).toBeTruthy();
    });

    it('shows the club as a mahjong tile', async () => {
      render(<ClubBoardScreen />);
      const tile = await screen.findByTestId('thread-header-avatar-club');
      expect(within(tile).getByTestId(`glyph-${glyphForClub('c1')}`)).toBeTruthy();
    });

    it('goes back through history when there is some', async () => {
      canGoBack.mockReturnValue(true);
      render(<ClubBoardScreen />);
      await screen.findByText('Cedar Falls Mah Jongg');
      fireEvent.click(screen.getByLabelText('Back'));
      expect(back).toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
    });

    it('lands on the club Board, not the inbox, with no history', async () => {
      canGoBack.mockReturnValue(false);
      render(<ClubBoardScreen />);
      await screen.findByText('Cedar Falls Mah Jongg');
      fireEvent.click(screen.getByLabelText('Back'));
      expect(replace).toHaveBeenCalledWith('/clubs/c1/board');
      expect(back).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalledWith('/messages');
    });

    it('falls back to /home when there is no history and the thread has not loaded', async () => {
      canGoBack.mockReturnValue(false);
      fetchThread.mockResolvedValue(null);
      render(<ClubBoardScreen />);
      fireEvent.click(await screen.findByLabelText('Back'));
      expect(replace).toHaveBeenCalledWith('/home');
      expect(back).not.toHaveBeenCalled();
    });

    it('renders the club pill as a plain label, not a button that could navigate away', async () => {
      render(<ClubBoardScreen />);
      await screen.findByText('Cedar Falls Mah Jongg');
      expect(
        screen.queryByRole('button', { name: /Cedar Falls Mah Jongg/ }),
      ).toBeNull();
    });

    it('renders only the back chevron when the thread cannot be read -- and still shows the posts', async () => {
      fetchThread.mockResolvedValue(null);
      fetchClubFeed.mockResolvedValue([post('p1', { body: 'Anyone free Thursday?' })]);
      render(<ClubBoardScreen />);
      await screen.findByText('Anyone free Thursday?');
      expect(screen.getByLabelText('Back')).toBeTruthy();
      expect(screen.queryByTestId('thread-header-avatar-club')).toBeNull();
      // No club id, so no roster read and no Announcement button.
      expect(fetchRoster).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Announcement' })).toBeNull();
    });
  });

  it('lifts the pinned composer above the iOS keyboard', async () => {
    platform.os = 'ios';
    try {
      render(<ClubBoardScreen />);
      await screen.findByText('Everyone in the club sees posts here');
      const kav = screen.getByTestId('kav');
      expect(within(kav).getByLabelText('Write to the club')).toBeTruthy();
    } finally {
      platform.os = 'web';
    }
  });
});
