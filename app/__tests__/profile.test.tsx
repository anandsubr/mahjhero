import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProfileScreen from '../profile';

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'test-user' } }, loading: false }),
}));

const fetchProfile = vi.fn();

vi.mock('../../lib/profile', () => ({
  fetchProfile: (...args: unknown[]) => fetchProfile(...args),
  updateProfile: vi.fn(async () => ({ error: null })),
  isCompleteProfile: (p: { display_name: string; skill_level: string | null }) =>
    p.display_name.trim().length > 0 && p.skill_level !== null,
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
});
