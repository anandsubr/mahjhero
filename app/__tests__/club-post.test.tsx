import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostScreen from '../messages/club/[threadId]/[postId]';

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
    fetchUnreadCounts: () => fetchUnreadCounts(),
  };
});

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
};

describe('a club post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchUnreadCounts.mockResolvedValue([]);
    fetchPostMessages.mockResolvedValue([root]);
    markPostRead.mockResolvedValue({ error: null });
    postMessage.mockResolvedValue({ id: 'm2', error: null });
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

  it('reports a failed load as a failure, not as an empty post', async () => {
    fetchPostMessages.mockResolvedValue(null);
    render(<PostScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
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
      expect(postMessage).toHaveBeenCalledWith('t1', 'I am', false, null, 'p1'),
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

  it('quotes a reply from inside this post -- reply_to is a pointer, independent of rootId', async () => {
    fetchPostMessages.mockResolvedValue([root, reply]);
    render(<PostScreen />);
    fireEvent.click(await screen.findByLabelText('Reply to Sara Lindqvist'));
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'I can play' },
    });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith('t1', 'I can play', false, 'm1', 'p1'),
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
});
