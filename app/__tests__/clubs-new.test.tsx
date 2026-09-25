import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewClubScreen from '../clubs/new';

const push = vi.fn();
const replace = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push, replace }),
  usePathname: () => '/clubs/new',
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire `useUnreadCounts`'s
  // fetch (now pulled in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// `vi.fn` returning a fixed object by default, not a fresh literal per call:
// TabBar's badge reads `useSession` too (via `useUnreadCounts`), and a fresh
// object there would break the referential stability its
// `useCallback([session])` depends on. `mockReturnValueOnce` below still
// lets a single test model signed-out/loading.
const SESSION: { session: { user: { id: string } } | null; loading: boolean } = {
  session: { user: { id: 'me' } },
  loading: false,
};
const useSessionMock = vi.fn(() => SESSION);
vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const createClub = vi.fn();
vi.mock('../../lib/clubs', () => ({
  createClub: (...a: unknown[]) => createClub(...a),
}));

// TabBar (now carried by this screen) calls `useUnreadCounts`, which reaches
// `fetchUnreadCounts`. Spread `actual` rather than replacing the module
// outright, the same pattern app/__tests__/friends.test.tsx uses.
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: vi.fn(async () => []),
  };
});

// TabBar also now calls useNotificationsUnread for its Alerts badge --
// without this it falls through to a real, unmocked RPC call.
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

beforeEach(() => {
  vi.clearAllMocks();
  useSessionMock.mockReturnValue(SESSION);
  createClub.mockResolvedValue({ clubId: 'club-9', error: null });
});

describe('new club screen', () => {
  it('creates a club and navigates to it', async () => {
    render(<NewClubScreen />);
    fireEvent.change(screen.getByLabelText('Club name'), {
      target: { value: 'Oakfield Tiles' },
    });
    fireEvent.click(screen.getByLabelText('Create the club'));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs/club-9'));
  });

  it('keeps Create the club disabled until the name has more than spaces', async () => {
    render(<NewClubScreen />);
    const create = screen.getByRole('button', { name: 'Create the club' });
    expect(create.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(create);
    expect(createClub).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Club name'), { target: { value: '   ' } });
    expect(create.getAttribute('aria-disabled')).toBe('true');

    fireEvent.change(screen.getByLabelText('Club name'), { target: { value: 'Oak' } });
    expect(create.getAttribute('aria-disabled')).not.toBe('true');
  });

  it('sends the description as the club rhythm', async () => {
    render(<NewClubScreen />);
    fireEvent.change(screen.getByLabelText('Club name'), { target: { value: 'Oakfield Tiles' } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Thursday evenings at the library' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create the club' }));
    await waitFor(() =>
      expect(createClub).toHaveBeenCalledWith('Oakfield Tiles', 'Thursday evenings at the library'),
    );
  });

  it('previews the club as it is typed', () => {
    render(<NewClubScreen />);
    const preview = screen.getByTestId('club-preview');
    expect(preview.textContent).toContain('?');
    expect(preview.textContent).toContain('Your club');
    expect(preview.textContent).toContain('Add a short description');

    fireEvent.change(screen.getByLabelText('Club name'), { target: { value: 'oakfield' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Tuesdays' } });
    expect(preview.textContent).toContain('O');
    expect(preview.textContent).toContain('oakfield');
    expect(preview.textContent).toContain('Tuesdays');
  });

  it('shows the error when creating fails', async () => {
    createClub.mockResolvedValueOnce({ clubId: null, error: 'That name is taken.' });
    render(<NewClubScreen />);
    fireEvent.change(screen.getByLabelText('Club name'), { target: { value: 'Oak' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create the club' }));
    expect(await screen.findByText('That name is taken.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  // A flow screen: the pinned Create button takes the tab bar's place once
  // the screen has loaded.
  it('hides the tab bar once loaded', async () => {
    render(<NewClubScreen />);
    expect(await screen.findByText('Start a club')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Club' })).toBeNull();
  });

  it('carries the tab bar while the session is still loading', () => {
    useSessionMock.mockReturnValueOnce({ session: null, loading: true });
    render(<NewClubScreen />);
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  // TabBar navigates with router.replace off an entry route that is itself
  // a Redirect, so the history stack is typically one deep: the ✕ goes to
  // the dashboard rather than back().
  it('closes to the dashboard', async () => {
    render(<NewClubScreen />);
    await screen.findByText('Start a club');
    fireEvent.click(screen.getByRole('button', { name: 'Back to your clubs' }));
    expect(push).toHaveBeenCalledWith('/clubs');
  });
});
