import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PostScreen from '../messages/club/[threadId]/[postId]';
import { GENERIC_ERROR } from '../../lib/constants';
import { glyphForClub } from '../../lib/dashboard';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/messages/club/t1/p1',
  useLocalSearchParams: () => ({ threadId: 't1', postId: 'p1' }),
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

// The subscription is lib/use-thread-realtime.ts, covered by its own unit
// tests (lib/use-thread-realtime.test.ts). A no-op stub is enough to prove
// this screen wires the hook up without re-testing the hook itself -- the
// same call app/__tests__/club-board.test.tsx already made.
const useThreadRealtime = vi.fn();
vi.mock('../../lib/use-thread-realtime', () => ({
  useThreadRealtime: (...a: unknown[]) => useThreadRealtime(...a),
}));

const fetchPostMessages = vi.fn();
const markPostRead = vi.fn();
const postMessage = vi.fn();
// The header's own best-effort read -- see the screen's own docstring on
// why it duplicates the board's identical call rather than trusting a
// value handed down from it.
const fetchThread = vi.fn();
// TabBar (carried by this screen via Screen's `tabBar` prop) calls
// useUnreadCounts, which reaches this -- the same reason every other screen
// test that renders TabBar mocks it.
const fetchUnreadCounts = vi.fn(async () => []);

vi.mock('../../lib/messages', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    fetchPostMessages: (...a: unknown[]) => fetchPostMessages(...a),
    markPostRead: (...a: unknown[]) => markPostRead(...a),
    postMessage: (...a: unknown[]) => postMessage(...a),
    fetchThread: (...a: unknown[]) => fetchThread(...a),
    fetchUnreadCounts: () => fetchUnreadCounts(),
  };
});

// TabBar also now calls useNotificationsUnread for its Alerts badge --
// without this it falls through to a real, unmocked RPC call.
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

// Composer now renders AttachmentPicker (Task 10), which imports
// lib/attachments.ts -- itself pulling in expo-crypto,
// expo-image-manipulator and expo-image-picker. None of these tests want to
// actually load those native modules, so this is mocked wholesale the same
// way AttachmentPicker.test.tsx and Composer.test.tsx already do for their
// own renders.
vi.mock('../../lib/attachments', () => ({
  pickImages: vi.fn(),
  compressImage: vi.fn(),
  uploadAttachment: vi.fn(),
  MAX_ATTACHMENTS: 4,
}));

const root = {
  id: 'p1',
  author_id: 'a1',
  body: 'Anyone free Thursday?',
  subject: null,
  is_announcement: false,
  created_at: '2026-08-30T10:00:00.000Z',
  profiles: { display_name: 'Alice Chen' },
  reply_to_id: null,
  reply_to: null,
  attachments: [],
};

const reply = {
  id: 'm1',
  author_id: 'other',
  body: 'We are one short for Tuesday.',
  subject: null,
  is_announcement: false,
  created_at: '2026-08-30T10:05:00.000Z',
  profiles: { display_name: 'Sara Lindqvist' },
  reply_to_id: null,
  reply_to: null,
  attachments: [],
};

describe('a club post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchUnreadCounts.mockResolvedValue([]);
    fetchPostMessages.mockResolvedValue([root]);
    markPostRead.mockResolvedValue({ error: null });
    postMessage.mockResolvedValue({ id: 'm2', error: null });
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

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the root and its replies', async () => {
    fetchPostMessages.mockResolvedValue([root, reply]);
    render(<PostScreen />);
    await waitFor(() =>
      expect(screen.getByText('Anyone free Thursday?')).toBeTruthy(),
    );
    expect(screen.getByText('We are one short for Tuesday.')).toBeTruthy();
  });

  it('marks the post read once it has loaded, and asks fetch_post_messages for this root', async () => {
    render(<PostScreen />);
    await waitFor(() => expect(markPostRead).toHaveBeenCalledWith('p1'));
    expect(fetchPostMessages).toHaveBeenCalledWith('p1');
  });

  it('does not mark the post read when the load fails', async () => {
    fetchPostMessages.mockResolvedValue(null);
    render(<PostScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(markPostRead).not.toHaveBeenCalled();
  });

  // This used to be a byte-for-byte repeat of the test above minus its
  // markPostRead assertion, so the "not as an empty post" half of its own
  // name was checked by nothing. `lib/` never rejects: null is "we could not
  // ask", and a post rendered as a blank scroller with a composer under it
  // would tell a member something false about their club's board.
  it('reports a failed load as a failure, not as an empty post', async () => {
    fetchPostMessages.mockResolvedValue(null);
    render(<PostScreen />);
    await waitFor(() => expect(screen.getByText(GENERIC_ERROR)).toBeTruthy());
    // The root that WOULD have rendered had the read succeeded.
    expect(screen.queryByTestId('bubble-p1')).toBeNull();
  });

  it('treats an empty row list the same as a failed load -- a post always has a root', async () => {
    fetchPostMessages.mockResolvedValue([]);
    render(<PostScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(markPostRead).not.toHaveBeenCalled();
  });

  it('posts a reply INTO the post, not into the thread -- rootId stays p1, reply_to stays null', async () => {
    render(<PostScreen />);
    const input = await screen.findByLabelText('Message');
    fireEvent.change(input, { target: { value: 'I am' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith('t1', 'I am', false, null, 'p1', []),
    );
  });

  it('keeps the draft and the quote when the send is refused', async () => {
    postMessage.mockResolvedValue({ id: null, error: 'Nope.' });
    fetchPostMessages.mockResolvedValue([root, reply]);
    render(<PostScreen />);
    fireEvent.click(await screen.findByLabelText('Reply to Sara Lindqvist'));
    const input = await screen.findByLabelText('Message');
    fireEvent.change(input, { target: { value: 'I am' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByText('Nope.')).toBeTruthy());
    expect((input as HTMLInputElement).value).toBe('I am');
    // The quote chip survives the failure too -- re-picking what was being
    // answered is the second-worst response to a failed send.
    expect(
      screen.getByText('Sara Lindqvist: We are one short for Tuesday.'),
    ).toBeTruthy();
  });

  /*
   * The screen carried ONE error slot, and `load()` cleared it -- so any
   * INSERT anywhere in this thread (the realtime callback calls `load()`)
   * wiped the refusal a member's own send had just produced, while their
   * unsent draft still sat in the composer with nothing left to explain it.
   * Somebody else replying to an unrelated post on the same board is enough.
   */
  it('keeps a send refusal on screen when an unrelated message arrives', async () => {
    postMessage.mockResolvedValue({ id: null, error: 'that message is too long' });
    render(<PostScreen />);
    const input = await screen.findByLabelText('Message');
    fireEvent.change(input, { target: { value: 'I am' } });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(screen.getByText('that message is too long')).toBeTruthy(),
    );

    // Somebody else posts anywhere in this thread. The subscription is
    // thread-wide (see the screen's own docstring), so this fires here.
    const onInsert = useThreadRealtime.mock.calls[0][2] as () => void;
    fetchPostMessages.mockResolvedValue([root, reply]);
    await act(async () => {
      onInsert();
      await Promise.resolve();
    });

    expect(screen.getByText('that message is too long')).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('I am');
  });

  it('quotes a reply from inside this post -- reply_to is a pointer, independent of rootId', async () => {
    fetchPostMessages.mockResolvedValue([root, reply]);
    render(<PostScreen />);
    fireEvent.click(await screen.findByLabelText('Reply to Sara Lindqvist'));
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'I can play' },
    });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith('t1', 'I can play', false, 'm1', 'p1', []),
    );
  });

  it('sends only once when Send is activated twice before the first send settles', async () => {
    let resolvePost!: (value: { id: string | null; error: string | null }) => void;
    postMessage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    render(<PostScreen />);
    const input = await screen.findByLabelText('Message');
    fireEvent.change(input, { target: { value: 'On my way' } });
    const send = screen.getByLabelText('Send');

    act(() => {
      fireEvent.click(send);
      fireEvent.click(send);
    });

    expect(postMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePost({ id: 'm3', error: null });
      await Promise.resolve();
    });
  });

  it('subscribes to the whole thread, not just this post', async () => {
    render(<PostScreen />);
    await waitFor(() =>
      expect(useThreadRealtime).toHaveBeenCalledWith('t1', 'me', expect.any(Function)),
    );
  });

  it('refetches this post when the thread-wide subscription fires', async () => {
    render(<PostScreen />);
    await waitFor(() => expect(fetchPostMessages).toHaveBeenCalledTimes(1));
    const onInsert = useThreadRealtime.mock.calls[0][2] as () => void;
    fetchPostMessages.mockResolvedValue([root, reply]);
    await act(async () => {
      onInsert();
      await Promise.resolve();
    });
    expect(fetchPostMessages).toHaveBeenCalledTimes(2);
  });

  // A post reached directly (a deep link, a notification) has the same
  // "which club is this" problem the board itself shipped with -- see the
  // screen's own docstring for why this carries the board's header too.
  describe('header', () => {
    it("shows the club's name once the thread has loaded", async () => {
      render(<PostScreen />);
      expect(await screen.findByText('Cedar Falls Mah Jongg')).toBeTruthy();
      expect(screen.getByTestId('thread-header-avatar-club')).toBeTruthy();
    });

    // This screen's own copy of the bug the board screen fixed (Task 8/9):
    // its ThreadAvatar call had no `asTile`/`clubId` of its own, so the same
    // club showed a mahjong tile on the board and a plain circle one tap
    // deeper, on its own post. Same idiom the board's own test uses (see its
    // comment above the matching test there): an explicit testID is passed
    // at this call site too, so it can't distinguish tile mode from the
    // plain circle on its own -- look for the glyph MahjongTile itself
    // renders inside the avatar container instead.
    it('shows the club as a mahjong tile, not a plain circle, on its own post', async () => {
      render(<PostScreen />);
      const tile = await screen.findByTestId('thread-header-avatar-club');
      expect(within(tile).getByTestId(`glyph-${glyphForClub('c1')}`)).toBeTruthy();
    });

    it('shows a back chevron, distinct from the Messages tab, that returns to the board', async () => {
      render(<PostScreen />);
      await screen.findByText('Cedar Falls Mah Jongg');
      expect(screen.getAllByRole('button', { name: 'Messages' })).toHaveLength(1);
      fireEvent.click(screen.getByLabelText('Back to board'));
      expect(push).toHaveBeenCalledWith('/messages/club/t1');
    });

    // The pill no longer navigates -- matching app/messages/club/new.tsx's
    // own inert pill (a control that looks tappable and does nothing is
    // worse than one that plainly isn't interactive).
    it('renders the club pill as a plain label, not a button that could navigate away', async () => {
      render(<PostScreen />);
      await screen.findByText('Cedar Falls Mah Jongg');
      expect(
        screen.queryByRole('button', { name: /Cedar Falls Mah Jongg/ }),
      ).toBeNull();
    });

    // A half-built header -- a pill with no name in it -- would tell a
    // member something false. The post's own messages must not disappear
    // just because this second, independent read failed.
    it('renders only the back chevron, not a half-built pill, when the thread cannot be read -- and still shows the post', async () => {
      fetchThread.mockResolvedValue(null);
      render(<PostScreen />);
      await screen.findByText('Anyone free Thursday?');
      expect(screen.getByLabelText('Back to board')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /view club/ })).toBeNull();
      expect(screen.queryByTestId('thread-header-avatar-club')).toBeNull();
    });
  });
});
