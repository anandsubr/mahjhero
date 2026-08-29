import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import NotificationSettings from '../notifications';

// Hoisted to module scope so the test can assert on it. A `push` created
// inside the useRouter factory would be a fresh spy on every render, so
// nothing outside the component could ever see the call.
const push = vi.hoisted(() => vi.fn());

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, back: vi.fn() }),
  // TabBar's own Alerts tab route: this screen IS /notifications, so its
  // highlighted Alerts button stays the documented no-op.
  usePathname: () => '/notifications',
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

// TabBar (carried by this screen) now calls `useUnreadCounts`, which reaches
// `fetchUnreadCounts`.
vi.mock('../../lib/messages', () => ({
  fetchUnreadCounts: vi.fn(async () => []),
}));

vi.mock('../../lib/profile', () => ({
  fetchPreferences: vi.fn(async () => ({
    notify_channel: 'both',
    mute_need_a_fourth: false,
    quiet_hours_enabled: true,
    quiet_hours_start: '21:00',
    quiet_hours_end: '08:00',
  })),
  updatePreferences: vi.fn(async () => ({ error: null })),
  isValidQuietWindow: () => true,
}));

describe('notifications screen', () => {
  beforeEach(() => vi.clearAllMocks());

  // Asserts the control *navigates*, not merely that the word "Profile" is
  // on screen. The defect this guards against stranded a member on a dead-end
  // screen; replacing the button with a static <Text>Profile</Text> would
  // reintroduce exactly that and still satisfy a text-only assertion.
  it('offers a way back to the profile screen', async () => {
    render(<NotificationSettings />);
    const back = await screen.findByRole('button', { name: 'Back to profile' });
    fireEvent.click(back);
    expect(push).toHaveBeenCalledWith('/profile');
  });

  it('lists the default channel first', async () => {
    render(<NotificationSettings />);
    await screen.findByText('Push and email');
    const options = screen.getAllByText(/Push and email|Push only|Email only/);
    expect(options[0].textContent).toBe('Push and email');
  });

  // Guards against `accessibilityState={{ selected }}` creeping back in:
  // react-native-web's createDOMProps has no handling for
  // `accessibilityState` at all (components/Toggle.tsx's docstring has the
  // full account), so that prop renders `role="radio"` with no state at all
  // -- a screen reader could not tell the chosen channel from the others.
  // Both states are pinned against their literal strings, not
  // `not.toBe('true')`, since a missing attribute would also satisfy that.
  it('marks the selected channel with aria-selected, and the others as not selected', async () => {
    render(<NotificationSettings />);
    const selected = await screen.findByRole('radio', { name: 'Push and email' });
    expect(selected.getAttribute('aria-selected')).toBe('true');

    const pushOnly = screen.getByRole('radio', { name: 'Push only' });
    expect(pushOnly.getAttribute('aria-selected')).toBe('false');
  });

  it('carries the tab bar with Alerts marked', async () => {
    render(<NotificationSettings />);
    expect(
      (await screen.findByRole('button', { name: 'Alerts' })).getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });
});
