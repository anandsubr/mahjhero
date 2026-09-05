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

// TabBar also now calls useNotificationsUnread for its Alerts badge --
// without this it falls through to a real, unmocked RPC call.
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

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

  // `ready` gates the whole "Send to" section, including the empty-state
  // card -- so a member whose fetch just hasn't landed yet should see
  // neither the picker nor a premature "nobody to message" claim. This is
  // the state Task 16 exists to keep honest: before candidates and errors
  // were told apart, this component's only user-visible states were
  // "spinner" and "the list (however empty)", with no way to catch a claim
  // rendered before the data it describes had actually arrived.
  it('shows no candidates and no empty-state claim while still loading', async () => {
    let resolveFriends: (value: unknown) => void = () => {};
    fetchFriends.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFriends = resolve;
      }),
    );
    render(<NewMessageScreen />);
    await screen.findByText('New message');

    expect(screen.queryByText('Send to')).toBeNull();
    expect(screen.queryByText(/Nobody to message yet/)).toBeNull();

    resolveFriends([]);
    await screen.findByText('Send to');
    expect(screen.queryByText(/Nobody to message yet/)).toBeNull();
  });

  // `null` is "we could not ask", `[]` is "you have no friends" -- telling a
  // member with a dead network that she has nobody to message is a false
  // statement about her, not a report on the network. Mirrors the identical
  // test in app/__tests__/friends.test.tsx.
  it('shows an error rather than the empty state when a fetch fails', async () => {
    fetchFriends.mockResolvedValueOnce(null);
    fetchAddablePeople.mockResolvedValueOnce([]);
    render(<NewMessageScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText(/Nobody to message yet/)).toBeNull();
  });

  // Genuinely nobody -- both fetches succeed and both come back empty. The
  // honest copy names the fix rather than leaving a bare "Send to" label
  // over empty space, which is the defect this screen shipped with once
  // "Everyone" (the only other target) was removed.
  it('shows the empty state and names the fix when there is genuinely nobody', async () => {
    fetchFriends.mockResolvedValueOnce([]);
    fetchAddablePeople.mockResolvedValueOnce([]);
    render(<NewMessageScreen />);
    expect(
      await screen.findByText(
        'Nobody to message yet. Add a friend or join a club to find people to message.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Could not reach MahjHero/)).toBeNull();
  });

  // Friends first: they are the people you deliberately kept, and they are
  // the only ones who may not appear under any club.
  it('lists friends above people from your clubs', async () => {
    render(<NewMessageScreen />);
    const names = await screen.findAllByText(/Bob Reyes|Carol Diaz/);
    expect(names.map((n) => n.textContent)).toEqual(['Bob Reyes', 'Carol Diaz']);
  });

  // The one-step "write here, send here" flow is gone: picking people is
  // now enough on its own to create (or open) the thread. The first
  // message -- text, images, or both -- is composed on the thread screen
  // itself afterward, through the same Composer every other thread already
  // uses (Task 10), never here.
  it('creates the thread and navigates to it, with no message posted here', async () => {
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Carol Diaz'));
    fireEvent.click(screen.getByLabelText('Start conversation'));
    await waitFor(() =>
      expect(createGroupThread).toHaveBeenCalledWith('', ['p1', 'p2']),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages/t9'));
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('deselects somebody picked by mistake', async () => {
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Start conversation'));
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
    fireEvent.click(screen.getByLabelText('Start conversation'));
    expect(
      await screen.findByText(
        'you can only message people from your clubs or your friends',
      ),
    ).toBeTruthy();
    expect(postMessage).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
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

  // The Messages tab renders active on this screen too, which reads as
  // "you are here" rather than a way out, so this screen carries its own
  // explicit back link again (2026-09-01-back-links-design.md). Its
  // accessible name is "Back to messages", distinct from TabBar's own tab
  // ("Messages") — `getAllByRole(..., { name: 'Messages' })` staying at 1
  // is what confirms the two controls do not collide.
  it('draws a back link to the messages list', async () => {
    render(<NewMessageScreen />);
    await screen.findByText('New message');
    expect(screen.getAllByRole('button', { name: 'Messages' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to messages' }));
    expect(push).toHaveBeenCalledWith('/messages');
  });
});
