import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import JoinScreen from '../join/[token]';

const setItem = vi.fn(async () => undefined);
const removeItem = vi.fn(async () => undefined);
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    setItem: (...a: unknown[]) => setItem(...(a as [])),
    removeItem: (...a: unknown[]) => removeItem(...(a as [])),
  },
}));

const replace = vi.fn();
// A stable object, not a fresh literal per `useRouter()` call: this screen's
// own effect lists `router` itself in its dependency array (unlike most
// other screens, which only close over `router` inside callbacks), so a
// fresh object every render would retrigger the effect -- and therefore
// `acceptInvite` -- on every one of this screen's own re-renders.
const router = { replace };
const searchParams: Record<string, string> = { token: 'tok-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => router,
  usePathname: () => '/join/tok-1',
  useLocalSearchParams: () => searchParams,
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire `useUnreadCounts`'s
  // fetch (now pulled in by TabBar, for a signed-in member) on every state
  // update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// `vi.fn` returning a fixed object by default, not a fresh literal per call:
// TabBar's badge reads `useSession` too (via `useUnreadCounts`), and a fresh
// object there would break the referential stability its
// `useCallback([session])` depends on. `mockReturnValue` below still lets a
// test model signed-out.
const SESSION: { session: { user: { id: string } } | null; loading: boolean } = {
  session: { user: { id: 'me' } },
  loading: false,
};
const useSessionMock = vi.fn(() => SESSION);
vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const acceptInvite = vi.fn();
vi.mock('../../lib/clubs', () => ({
  PENDING_INVITE_KEY: 'mahjhero.pending-invite',
  acceptInvite: (...a: unknown[]) => acceptInvite(...a),
}));

// TabBar (carried by this screen for a signed-in member) calls
// `useUnreadCounts`, which reaches `fetchUnreadCounts`.
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
  searchParams.token = 'tok-1';
});

describe('join screen', () => {
  it('accepts the invite and replaces to the new club', async () => {
    acceptInvite.mockResolvedValueOnce({ clubId: 'club-3', error: null });
    render(<JoinScreen />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs/club-3'));
  });

  it('shows the refusal when the invite could not be accepted', async () => {
    acceptInvite.mockResolvedValueOnce({
      clubId: null,
      error: 'That invite link is no longer valid.',
    });
    render(<JoinScreen />);
    expect(
      await screen.findByText('That invite link is no longer valid.'),
    ).toBeTruthy();
  });

  // TabBar navigates with router.replace off an entry route that is itself a
  // Redirect, so the history stack is typically one deep. A signed-in member
  // stuck here -- mid-join, or with a dead link -- would otherwise have no
  // way out short of relaunching the app.
  it('carries the tab bar with Club marked while the invite is being accepted', () => {
    // A promise that never settles, so the screen stays on its spinner for
    // the life of the test.
    acceptInvite.mockReturnValueOnce(new Promise(() => {}));
    render(<JoinScreen />);
    expect(
      screen.getByRole('button', { name: 'Club' }).getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('carries the tab bar when the invite could not be accepted', async () => {
    acceptInvite.mockResolvedValueOnce({
      clubId: null,
      error: 'That invite link is no longer valid.',
    });
    render(<JoinScreen />);
    await screen.findByText('That invite link is no longer valid.');
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  // This screen is reachable while SIGNED OUT (a member who has never used
  // the app opens an invite link cold) -- the one screen in the app's
  // signed-in set that is. A tab bar here would offer four destinations that
  // all bounce straight back to sign-in, so it must stay off for exactly
  // this state.
  it('does not carry the tab bar while signed out and parking the invite', () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    // A promise that never settles, so the screen stays on its spinner
    // (mid-`setItem`, pre-redirect) for the life of the test.
    setItem.mockReturnValueOnce(new Promise(() => {}));
    render(<JoinScreen />);
    expect(screen.queryByRole('button', { name: 'Club' })).toBeNull();
  });

  it('does not carry the tab bar while the session is still loading', () => {
    useSessionMock.mockReturnValue({ session: null, loading: true });
    render(<JoinScreen />);
    expect(screen.queryByRole('button', { name: 'Club' })).toBeNull();
  });
});
