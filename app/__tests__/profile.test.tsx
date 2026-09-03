import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProfileScreen from '../profile';

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  // TabBar's own Profile tab route: this screen IS /profile, so its
  // highlighted Profile button stays the documented no-op.
  usePathname: () => '/profile',
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
const SESSION = { session: { user: { id: 'test-user' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const fetchProfile = vi.fn();

vi.mock('../../lib/profile', () => ({
  fetchProfile: (...args: unknown[]) => fetchProfile(...args),
  updateProfile: vi.fn(async () => ({ error: null })),
  isCompleteProfile: (p: { display_name: string; skill_level: string | null }) =>
    p.display_name.trim().length > 0 && p.skill_level !== null,
}));

// TabBar (carried by this screen) now calls `useUnreadCounts`, which reaches
// `fetchUnreadCounts`.
// Spread `actual` rather than replacing the module outright: TabBar (carried
// by this screen) now also calls `unreadSuffix`, a pure helper covered by
// lib/messages.test.ts -- only `fetchUnreadCounts` needs to be a
// controllable double here.
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

describe('profile screen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an error rather than a blank editable form when the load fails', async () => {
    fetchProfile.mockResolvedValueOnce(null);
    render(<ProfileScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('explains why Save is unavailable when the profile is incomplete', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: '',
      skill_level: null,
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    expect(
      await screen.findByText(/Add your name and skill level/),
    ).toBeTruthy();
  });

  // Guards against `accessibilityState={{ selected }}` creeping back into
  // SkillLevelPicker: react-native-web's createDOMProps has no handling for
  // `accessibilityState` at all (components/Toggle.tsx's docstring has the
  // full account), so that prop renders `role="radio"` with no state at all
  // -- a screen reader could not tell a member's saved skill level from the
  // other two tiles. Both states are pinned against their literal strings,
  // not `not.toBe('true')`, since a missing attribute would also satisfy
  // that.
  it('marks the saved skill level with aria-selected, and the others as not selected', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    const selected = await screen.findByRole('radio', { name: 'Intermediate' });
    expect(selected.getAttribute('aria-selected')).toBe('true');

    const beginner = screen.getByRole('radio', { name: 'Beginner' });
    expect(beginner.getAttribute('aria-selected')).toBe('false');
  });

  it('carries the tab bar with Profile marked', async () => {
    // Arrange exactly as the file's existing "renders the form" test does.
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    expect(
      (await screen.findByRole('button', { name: 'Profile' })).getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  // Profile was reachable only by pushing onto a stack when this link was
  // added. The tab bar now sits under every tab screen and its Club tab is
  // the same destination, so the link was a second way to do one thing.
  it('has no back link now the tab bar carries that job', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    expect(await screen.findByText('Save')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to your clubs' })).toBeNull();
  });

  // Sign out was a left-aligned ghost text button — the design system's own
  // treatment, and it read as a stray link rather than the control that ends
  // the session.
  it('renders sign out as a full-width destructive button', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    // `getComputedStyle`, not `.style`: this repo's react-native-web emits
    // atomic CSS classes into an injected stylesheet rather than flattening
    // StyleSheet values onto the node's inline style, so `.style.*` reads
    // empty for every variant — an assertion that would pass whether or not
    // the variant were applied. Task 6 established this.
    expect(getComputedStyle(signOut).backgroundColor).toBe('rgb(255, 225, 208)');
    // `block` sets `width: '100%'` via StyleSheet, so it atomizes the same
    // way — assert the resolved value, not merely that something is set.
    expect(getComputedStyle(signOut).width).toBe('100%');
  });

  // The only way to /friends. app/friends.tsx has no tab and nothing else
  // links to it, so this assertion is what keeps the screen reachable.
  it('links to the friends screen', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Alice Ng',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    expect(await screen.findByText('Friends')).toBeTruthy();
  });

  // The tile is purely decorative -- scoped to a wrapping testID rather than
  // a bare `[aria-hidden="true"]` query, since TabBar (carried by every
  // screen) renders its own five `aria-hidden` tiles too, which would let a
  // bare query pass whether or not this screen's own section tile exists.
  it('shows a decorative red-dragon tile before the heading', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    await screen.findByText('Your profile');
    expect(
      screen.getByTestId('section-tile').querySelector('[aria-hidden="true"]'),
    ).toBeTruthy();
  });
});
