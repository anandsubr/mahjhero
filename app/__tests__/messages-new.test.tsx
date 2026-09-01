import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewMessageScreen from '../messages/new';

const push = vi.fn();
const replace = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, replace, back: vi.fn() }),
  usePathname: () => '/messages/new',
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire `useUnreadCounts`'s
  // fetch (now pulled in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// Module-scoped constant, not a fresh object per render: a fresh object
// would break the referential stability the real SessionProvider gives
// useSession, and can produce a real render loop in a component that
// depends on `session` in a hook's dependency array (this one does).
const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const fetchFriends = vi.fn();
const fetchAddablePeople = vi.fn();
const createGroupThread = vi.fn();
const postMessage = vi.fn();

vi.mock('../../lib/friends', () => ({
  fetchFriends: (...a: unknown[]) => fetchFriends(...a),
  fetchAddablePeople: (...a: unknown[]) => fetchAddablePeople(...a),
}));

vi.mock('../../lib/messages', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    createGroupThread: (...a: unknown[]) => createGroupThread(...a),
    postMessage: (...a: unknown[]) => postMessage(...a),
    // TabBar (now carried by this screen) calls `useUnreadCounts`, which
    // reaches this.
    fetchUnreadCounts: vi.fn(async () => []),
  };
});

describe('new message screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchFriends.mockResolvedValue([
      { profile_id: 'p1', display_name: 'Bob Reyes', club_names: [] },
    ]);
    fetchAddablePeople.mockResolvedValue([
      { profile_id: 'p2', display_name: 'Carol Diaz', club_name: 'Riverside' },
    ]);
    createGroupThread.mockResolvedValue({ id: 't9', error: null });
    postMessage.mockResolvedValue({ id: 'm1', error: null });
  });

  // Friends first: they are the people you deliberately kept, and they are
  // the only ones who may not appear under any club.
  it('lists friends above people from your clubs', async () => {
    render(<NewMessageScreen />);
    const names = await screen.findAllByText(/Bob Reyes|Carol Diaz/);
    expect(names.map((n) => n.textContent)).toEqual(['Bob Reyes', 'Carol Diaz']);
  });

  // Creating a thread in someone else's list for the first time always
  // needs something to say -- the one-step flow's whole point is that an
  // empty person-to-person thread can no longer be created.
  it('refuses an empty message to People before any RPC call', async () => {
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Send'));
    expect(await screen.findByText('Write something first.')).toBeTruthy();
    expect(createGroupThread).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('creates a group from the picked people and posts the first message', async () => {
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Carol Diaz'));
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Table for four Tuesday?' },
    });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(createGroupThread).toHaveBeenCalledWith('', ['p1', 'p2']),
    );
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        't9',
        'Table for four Tuesday?',
        false,
        null,
      ),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages/t9'));
  });

  it('deselects somebody picked by mistake', async () => {
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Bob Reyes'));
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() => expect(createGroupThread).not.toHaveBeenCalled());
    expect(await screen.findByText('Pick somebody to message.')).toBeTruthy();
  });

  it('surfaces a refusal instead of navigating', async () => {
    createGroupThread.mockResolvedValueOnce({
      id: null,
      error: 'you can only message people from your clubs or your friends',
    });
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hello' },
    });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(
      await screen.findByText(
        'you can only message people from your clubs or your friends',
      ),
    ).toBeTruthy();
    expect(postMessage).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  // The thread was already created by the time the post fails -- undoing
  // that isn't a call this screen can make. What it owes the member: the
  // text they typed is still there (not silently dropped), the refusal is
  // shown (not swallowed), and they are NOT bounced into a half-created
  // thread. A second tap retries the POST into the thread that already
  // exists rather than creating a second, near-duplicate one.
  it('keeps the message and retries the post, not the create, after a failed post', async () => {
    postMessage.mockResolvedValueOnce({
      id: null,
      error: 'that message could not be sent',
    });
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    const input = screen.getByLabelText('Message');
    fireEvent.change(input, { target: { value: 'Table for four Tuesday?' } });
    fireEvent.click(screen.getByLabelText('Send'));

    expect(
      await screen.findByText('that message could not be sent'),
    ).toBeTruthy();
    expect((input as HTMLTextAreaElement).value).toBe('Table for four Tuesday?');
    expect(replace).not.toHaveBeenCalled();
    expect(createGroupThread).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Send'));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        't9',
        'Table for four Tuesday?',
        false,
        null,
      ),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages/t9'));
    // Retried the post into the thread already created -- did not create a
    // second one.
    expect(createGroupThread).toHaveBeenCalledTimes(1);
  });

  // TabBar navigates with router.replace off an entry route that is itself
  // a Redirect, so the history stack is typically one deep. A compose screen
  // with no bar would be a dead end on native short of relaunching the app.
  it('carries the tab bar with Messages marked', async () => {
    render(<NewMessageScreen />);
    await screen.findByText('New message');
    expect(
      screen.getByRole('button', { name: 'Messages' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  // Removed with the tab bar's arrival: the Messages tab reaches the
  // identical route (`/messages`) this screen's own back link used to, so
  // the ghost button above the heading was a second way to do one thing --
  // the same reasoning the club detail screen's own "no longer draws its
  // own back link" test already records. Pinned as a count rather than a
  // `queryByRole` miss: this control shared its accessible name ("Messages")
  // with TabBar's own tab, so a stray second one would otherwise pass a
  // `queryByRole(..., { name: 'Messages' })` check silently.
  it('no longer draws its own back link', async () => {
    render(<NewMessageScreen />);
    await screen.findByText('New message');
    expect(screen.getAllByRole('button', { name: 'Messages' })).toHaveLength(1);
  });
});
