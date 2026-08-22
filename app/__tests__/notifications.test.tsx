import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotificationSettings from '../notifications';

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
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

  it('offers a way back to the profile screen', async () => {
    render(<NotificationSettings />);
    expect(await screen.findByText('Profile')).toBeTruthy();
  });

  it('lists the default channel first', async () => {
    render(<NotificationSettings />);
    await screen.findByText('Push and email');
    const options = screen.getAllByText(/Push and email|Push only|Email only/);
    expect(options[0].textContent).toBe('Push and email');
  });
});
