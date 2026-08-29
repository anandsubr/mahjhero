import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewMessageScreen from '../messages/new';

const push = vi.fn();
const replace = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, replace, back: vi.fn() }),
  usePathname: () => '/messages/new',
}));

// Module-scoped constant, not a fresh object per render: a fresh object
// would break the referential stability the real SessionProvider gives
// useSession, and can produce a real render loop in a component that
// depends on `session` in a hook's dependency array (this one does).
const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const fetchMyClubs = vi.fn();
const fetchFriends = vi.fn();
const fetchAddablePeople = vi.fn();
const openThreadForClub = vi.fn();
const createGroupThread = vi.fn();

vi.mock('../../lib/clubs', () => ({
  fetchMyClubs: (...a: unknown[]) => fetchMyClubs(...a),
}));

vi.mock('../../lib/friends', () => ({
  fetchFriends: (...a: unknown[]) => fetchFriends(...a),
  fetchAddablePeople: (...a: unknown[]) => fetchAddablePeople(...a),
}));

vi.mock('../../lib/messages', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/messages')>('../../lib/messages');
  return {
    ...actual,
    openThreadForClub: (...a: unknown[]) => openThreadForClub(...a),
    createGroupThread: (...a: unknown[]) => createGroupThread(...a),
  };
});

const RIVERSIDE = { id: 'c1', name: 'Riverside', rhythm: 'Tuesdays' };
const OAKFIELD = { id: 'c2', name: 'Oakfield', rhythm: 'Thursdays' };

describe('new message screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMyClubs.mockResolvedValue([RIVERSIDE, OAKFIELD]);
    fetchFriends.mockResolvedValue([
      { profile_id: 'p1', display_name: 'Bob Reyes', club_names: [] },
    ]);
    fetchAddablePeople.mockResolvedValue([
      { profile_id: 'p2', display_name: 'Carol Diaz', club_name: 'Riverside' },
    ]);
    openThreadForClub.mockResolvedValue({ id: 't1', error: null });
    createGroupThread.mockResolvedValue({ id: 't9', error: null });
  });

  it('offers Everyone and People, and not the artboard’s middle segment', async () => {
    render(<NewMessageScreen />);
    expect(await screen.findByText('Everyone')).toBeTruthy();
    expect(screen.getByText('People')).toBeTruthy();
    expect(screen.queryByText('A group')).toBeNull();
  });

  // A member in one club has nothing to switch between.
  //
  // The brief's version of this test called render() a second time inside
  // the same `it` without unmounting the first tree. vitest.setup.ts only
  // registers `cleanup` on `afterEach`, so within one test both trees stay
  // mounted side by side in document.body — and RTL's bound queries
  // (whether from `screen` or destructured off a `render()` result) query
  // `baseElement`, which defaults to `document.body`, not the caller's own
  // container. So a `queryByLabelText` taken after the second render would
  // still see the FIRST tree's still-mounted "Oakfield" chip and the
  // assertion that it's gone would fail even for a correct implementation.
  // Unmounting the first tree before mounting the second makes the second
  // render's DOM state actually isolated, which is what the test needs to
  // mean what it says.
  it('shows the club chips only when there is more than one club', async () => {
    const { unmount } = render(<NewMessageScreen />);
    expect(await screen.findByLabelText('Riverside')).toBeTruthy();
    expect(screen.getByLabelText('Oakfield')).toBeTruthy();
    unmount();

    fetchMyClubs.mockResolvedValueOnce([RIVERSIDE]);
    render(<NewMessageScreen />);
    await waitFor(() => expect(fetchMyClubs).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Oakfield')).toBeNull();
  });

  it('sends Everyone to the picked club’s thread', async () => {
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByLabelText('Oakfield'));
    fireEvent.click(screen.getByText('Everyone'));
    fireEvent.click(screen.getByLabelText('Start'));
    await waitFor(() => expect(openThreadForClub).toHaveBeenCalledWith('c2'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages/t1'));
  });

  // Friends first: they are the people you deliberately kept, and they are
  // the only ones who may not appear under any club.
  it('lists friends above people from your clubs', async () => {
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByText('People'));
    const names = await screen.findAllByText(/Bob Reyes|Carol Diaz/);
    expect(names.map((n) => n.textContent)).toEqual(['Bob Reyes', 'Carol Diaz']);
  });

  it('creates a group from the picked people', async () => {
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByText('People'));
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Carol Diaz'));
    fireEvent.click(screen.getByLabelText('Start'));
    await waitFor(() =>
      expect(createGroupThread).toHaveBeenCalledWith('', ['p1', 'p2']),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/messages/t9'));
  });

  it('deselects somebody picked by mistake', async () => {
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByText('People'));
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Start'));
    await waitFor(() => expect(createGroupThread).not.toHaveBeenCalled());
    expect(await screen.findByText('Pick somebody to message.')).toBeTruthy();
  });

  it('surfaces a refusal instead of navigating', async () => {
    createGroupThread.mockResolvedValueOnce({
      id: null,
      error: 'you can only message people from your clubs or your friends',
    });
    render(<NewMessageScreen />);
    fireEvent.click(await screen.findByText('People'));
    fireEvent.click(await screen.findByLabelText('Bob Reyes'));
    fireEvent.click(screen.getByLabelText('Start'));
    expect(
      await screen.findByText(
        'you can only message people from your clubs or your friends',
      ),
    ).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });
});
