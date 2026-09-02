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

  // TabBar navigates with router.replace off an entry route that is itself a
  // Redirect, so the history stack is typically one deep. A signed-in member
  // reaching this screen with no bar and (below) no back link would be a
  // dead end short of relaunching the app.
  it('carries the tab bar with Club marked', async () => {
    render(<NewClubScreen />);
    expect(await screen.findByText('Start a club')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('carries the tab bar while the session is still loading', () => {
    useSessionMock.mockReturnValueOnce({ session: null, loading: true });
    render(<NewClubScreen />);
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  // Same reasoning as the club detail screen's own back-link test
  // (2026-09-01-back-links-design.md): the Club tab renders active here
  // too, so it reads as "you are here" rather than a way out.
  it('draws a back link to the dashboard', async () => {
    render(<NewClubScreen />);
    await screen.findByText('Start a club');
    fireEvent.click(screen.getByRole('button', { name: 'Back to your clubs' }));
    expect(push).toHaveBeenCalledWith('/clubs');
  });
});
