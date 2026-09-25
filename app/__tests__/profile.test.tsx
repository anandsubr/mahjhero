import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProfileScreen from '../profile';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('expo-router', () => ({
  Redirect: () => null,
  useRouter: () => ({ push, back: vi.fn() }),
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
const SESSION = {
  session: { user: { id: 'test-user', email: 'test-user@example.com' } },
  loading: false,
};
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

const fetchProfile = vi.fn();
const updateProfile = vi.fn(async () => ({ error: null as string | null }));

vi.mock('../../lib/profile', () => ({
  fetchProfile: (...args: unknown[]) => fetchProfile(...args),
  updateProfile: (...args: unknown[]) => updateProfile(...(args as [])),
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
    expect(screen.queryByText('Save changes')).toBeNull();
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
  // the skill control: react-native-web's createDOMProps has no handling for
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

  // There was previously no place on this screen (or anywhere else) that
  // showed a member their own account's email -- it comes from the auth
  // session, not the profiles table, since profiles has no email column.
  it('shows the signed-in account email, read-only', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    expect(await screen.findByText('test-user@example.com')).toBeTruthy();
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
    expect(await screen.findByText('About you')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to your clubs' })).toBeNull();
  });

  it('shows the saved name and level in the identity row', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    const identity = await screen.findByTestId('profile-identity');
    expect(identity.textContent).toContain('P');
    expect(identity.textContent).toContain('Pat');
    expect(identity.textContent).toContain('Intermediate');
  });

  // Save changes exists only while the form differs from what was saved.
  it('offers Save changes only once something changes, then confirms Saved', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    await screen.findByText('About you');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Advanced' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy());
    expect(updateProfile).toHaveBeenCalledWith('test-user', {
      display_name: 'Pat',
      skill_level: 'advanced',
    });
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    // The identity row follows the saved level, not the draft.
    expect(screen.getByTestId('profile-identity').textContent).toContain('Advanced');
  });

  it('hides Save changes again when an edit is undone', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    const name = await screen.findByLabelText('Display name');
    fireEvent.change(name, { target: { value: 'Patricia' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Pat' } });
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('does not show Saved after a failed write', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    updateProfile.mockResolvedValueOnce({ error: 'Nope' });
    render(<ProfileScreen />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Beginner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Nope')).toBeTruthy();
    expect(screen.queryByText('Saved')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('renders sign out on a surface button', async () => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    // `getComputedStyle`, not `.style`: react-native-web emits atomic CSS
    // classes rather than inline styles.
    expect(getComputedStyle(signOut).backgroundColor).toBe('rgb(235, 221, 197)');
  });

  // The only way to /friends and /how-it-works -- nothing else in the app
  // links to either, so these keep the screens reachable.
  it.each([
    ['Notifications', '/notifications'],
    ['Friends', '/friends'],
    ['How it works', '/how-it-works'],
  ])('the %s row opens %s', async (title, href) => {
    fetchProfile.mockResolvedValueOnce({
      id: 'test-user',
      display_name: 'Pat',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ProfileScreen />);
    fireEvent.click(await screen.findByRole('button', { name: title }));
    expect(push).toHaveBeenCalledWith(href);
  });

  it('does not show a Greetings admin card for an ordinary member', async () => {
    fetchProfile.mockResolvedValue({
      id: 'you',
      display_name: 'Anand',
      skill_level: null,
      avatar_url: null,
      timezone: 'America/New_York',
      is_admin: false,
    });
    render(<ProfileScreen />);
    await screen.findByText('Friends');
    expect(screen.queryByText('Greetings')).toBeNull();
  });

  it('shows a Greetings admin card for an admin', async () => {
    fetchProfile.mockResolvedValue({
      id: 'you',
      display_name: 'Anand',
      skill_level: null,
      avatar_url: null,
      timezone: 'America/New_York',
      is_admin: true,
    });
    render(<ProfileScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Greetings' }));
    expect(push).toHaveBeenCalledWith('/admin/greetings');
  });
});
