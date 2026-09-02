import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import FriendsScreen from '../friends';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, back: vi.fn() }),
  usePathname: () => '/friends',
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire `useUnreadCounts`'s
  // fetch (now pulled in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// Module-scoped constant, not a fresh object per render: TabBar's badge now
// reads `useSession` too (via `useUnreadCounts`), and a fresh object here
// breaks the referential stability its `useCallback([session])` depends on,
// refiring the fetch on every render.
const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

// TabBar (now carried by this screen) calls `useUnreadCounts`, which reaches
// `fetchUnreadCounts`. Spread `actual` rather than replacing the module
// outright: TabBar also calls `unreadSuffix`, a pure helper covered by
// lib/messages.test.ts -- only `fetchUnreadCounts` needs to be a
// controllable double here.
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: vi.fn(async () => []),
  };
});

const fetchFriends = vi.fn();
const fetchAddablePeople = vi.fn();
const addFriend = vi.fn();
const removeFriend = vi.fn();

vi.mock('../../lib/friends', async () => {
  // sharedClubsLabel is pure and already covered in lib/friends.test.ts;
  // mocking it would only let this screen render a label the real one never
  // produces.
  const actual = await vi.importActual<typeof import('../../lib/friends')>(
    '../../lib/friends',
  );
  return {
    sharedClubsLabel: actual.sharedClubsLabel,
    fetchFriends: (...a: unknown[]) => fetchFriends(...a),
    fetchAddablePeople: (...a: unknown[]) => fetchAddablePeople(...a),
    addFriend: (...a: unknown[]) => addFriend(...a),
    removeFriend: (...a: unknown[]) => removeFriend(...a),
  };
});

const BOB = { profile_id: 'p1', display_name: 'Bob Reyes', club_names: ['Riverside'] };
const CAROL = { profile_id: 'p2', display_name: 'Carol Diaz', club_name: 'Oakfield' };

describe('friends screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchFriends.mockResolvedValue([]);
    fetchAddablePeople.mockResolvedValue([]);
    addFriend.mockResolvedValue({ error: null });
    removeFriend.mockResolvedValue({ error: null });
  });

  it('draws a back link to profile', async () => {
    render(<FriendsScreen />);
    await screen.findByText('Friends');
    fireEvent.click(screen.getByRole('button', { name: 'Back to profile' }));
    expect(push).toHaveBeenCalledWith('/profile');
  });

  it('lists a friend with the clubs they still share', async () => {
    fetchFriends.mockResolvedValueOnce([BOB]);
    render(<FriendsScreen />);
    expect(await screen.findByText('Bob Reyes')).toBeTruthy();
    expect(screen.getByText('Riverside')).toBeTruthy();
  });

  it('says so plainly for a friend from a club neither of you is in now', async () => {
    fetchFriends.mockResolvedValueOnce([{ ...BOB, club_names: [] }]);
    render(<FriendsScreen />);
    expect(await screen.findByText('No clubs in common')).toBeTruthy();
  });

  it('shows the dashed empty card when there are no friends yet', async () => {
    render(<FriendsScreen />);
    expect(await screen.findByText(/No friends yet/)).toBeTruthy();
  });

  // "we could not ask" and "you have no friends" are different claims. An
  // empty state for a failed read tells the member something false about
  // themselves.
  it('shows an error rather than the empty card when the load fails', async () => {
    fetchFriends.mockResolvedValueOnce(null);
    render(<FriendsScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText(/No friends yet/)).toBeNull();
  });

  it('offers club-mates who are not yet friends, and adds one', async () => {
    fetchAddablePeople.mockResolvedValueOnce([CAROL]);
    render(<FriendsScreen />);
    expect(await screen.findByText('Carol Diaz')).toBeTruthy();
    expect(screen.getByText('Oakfield')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Add Carol Diaz'));
    await waitFor(() => expect(addFriend).toHaveBeenCalledWith('p2'));
    // Both lists move: she leaves the suggestions and joins the friends.
    await waitFor(() => expect(fetchFriends).toHaveBeenCalledTimes(2));
  });

  it('surfaces a refusal from add_friend in the member’s own words', async () => {
    fetchAddablePeople.mockResolvedValueOnce([CAROL]);
    addFriend.mockResolvedValueOnce({
      error: 'you can only add someone from one of your clubs',
    });
    render(<FriendsScreen />);
    fireEvent.click(await screen.findByLabelText('Add Carol Diaz'));
    expect(
      await screen.findByText('you can only add someone from one of your clubs'),
    ).toBeTruthy();
  });

  // A second activation landing in the same tick as the first — a queued
  // tap, a screen-reader double-activation — must not slip past the guard
  // just because React hasn't re-rendered with the new `busy` state yet.
  // Both clicks are fired inside one `act` so neither gets a re-render in
  // between, reproducing that same-tick window deterministically.
  it('does not double-fire addFriend when Add is activated twice before the write resolves', async () => {
    fetchAddablePeople.mockResolvedValueOnce([CAROL]);
    let resolveAdd: (v: { error: string | null }) => void = () => {};
    addFriend.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdd = resolve;
        }),
    );
    render(<FriendsScreen />);
    const addButton = await screen.findByLabelText('Add Carol Diaz');

    act(() => {
      fireEvent.click(addButton);
      fireEvent.click(addButton);
    });

    expect(addFriend).toHaveBeenCalledTimes(1);

    resolveAdd({ error: null });
    await waitFor(() => expect(fetchFriends).toHaveBeenCalledTimes(2));
  });

  it('removes a friend and reloads', async () => {
    fetchFriends.mockResolvedValueOnce([BOB]);
    render(<FriendsScreen />);
    fireEvent.click(await screen.findByLabelText('Remove Bob Reyes'));
    await waitFor(() => expect(removeFriend).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(fetchFriends).toHaveBeenCalledTimes(2));
  });

  // TabBar navigates with router.replace off an entry route that is itself
  // a Redirect, so the history stack is typically one deep. A friends screen
  // with no bar would be a dead end on native short of relaunching the app.
  // Profile, not Messages -- this screen hangs off Profile.
  it('carries the tab bar with Profile marked', async () => {
    render(<FriendsScreen />);
    await screen.findByText('Friends');
    expect(
      screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('carries the tab bar when the load fails', async () => {
    fetchFriends.mockResolvedValueOnce(null);
    render(<FriendsScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Profile' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

});
