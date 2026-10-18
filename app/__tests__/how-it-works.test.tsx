import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const canGoBack = vi.fn(() => true);
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  useRouter: () => ({ push, replace, back, canGoBack }),
  usePathname: () => '/how-it-works',
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const SESSION = { session: { user: { id: 'u1' } }, loading: false };
let current: { session: { user: { id: string } } | null; loading: boolean } = SESSION;
vi.mock('../../lib/session', () => ({ useSession: () => current }));
vi.mock('../../lib/use-unread', () => ({ useUnreadCounts: () => ({ total: 0, byClub: {} }) }));
vi.mock('../../lib/use-notifications-unread', () => ({ useNotificationsUnread: () => 0 }));

const reset = vi.fn();
vi.mock('../../lib/use-guides', () => ({
  useGuides: () => ({ isVisible: () => false, dismiss: vi.fn(), reset }),
}));

import HowItWorks from '../how-it-works';

beforeEach(() => {
  vi.clearAllMocks();
  canGoBack.mockReturnValue(true);
  current = SESSION;
});

describe('How it works', () => {
  // Reached from Profile, so back pops to it rather than stacking a second
  // Profile on top -- and a deep link with no history still lands there.
  it('pops back to Profile when there is history', async () => {
    render(<HowItWorks />);
    await screen.findByText('How it works');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Profile' }));
    expect(back).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to Profile when there is nothing to pop', async () => {
    canGoBack.mockReturnValue(false);
    render(<HowItWorks />);
    await screen.findByText('How it works');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Profile' }));
    expect(replace).toHaveBeenCalledWith('/profile');
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
  it('explains playing and organizing', () => {
    render(<HowItWorks />);
    expect(screen.getByText('How it works')).toBeTruthy();
    expect(screen.getByText(/Tap Join to take a spot, or Invite to bring someone along/)).toBeTruthy();
    expect(screen.getByText(/Schedule your first game/)).toBeTruthy();
  });

  it('shows tips again on request', async () => {
    reset.mockResolvedValue(true);
    render(<HowItWorks />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show tips again' })));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByText('Tips will show again.')).toBeTruthy();
  });

  it('says so when tips could not be reset', async () => {
    reset.mockResolvedValue(false);
    render(<HowItWorks />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show tips again' })));
    expect(screen.getByText(/Could not reach MahjHero/)).toBeTruthy();
  });

  it('sends a signed-out visitor to sign in', () => {
    current = { session: null, loading: false };
    render(<HowItWorks />);
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/sign-in');
  });
});
