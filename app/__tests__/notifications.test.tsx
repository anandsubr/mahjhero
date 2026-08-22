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
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'test-user' } }, loading: false }),
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
});
