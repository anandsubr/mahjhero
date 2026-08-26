import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: null, loading: false }),
}));

// Mocked whole rather than partially: lib/auth pulls in expo-auth-session,
// expo-web-browser and expo-linking, none of which resolve under Vitest, and
// none of which this test exercises.
vi.mock('../../lib/auth', () => ({
  availableProviders: () => ['google'],
  isValidEmail: (value: string) => value.includes('@'),
  sendMagicLink: vi.fn(async () => ({ error: null })),
  signInWithProvider: vi.fn(async () => ({ error: null })),
}));

import SignIn from '../sign-in';

describe('sign-in screen', () => {
  beforeEach(() => vi.clearAllMocks());

  // Sign-in is now a step inside the welcome screen rather than the app's
  // front door, so it needs a way back to it.
  it('offers a way back to the welcome screen', () => {
    render(<SignIn />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to the welcome screen' }),
    );
    expect(push).toHaveBeenCalledWith('/welcome');
  });

  it('still offers the magic-link form', () => {
    render(<SignIn />);
    expect(screen.getByText('Sign in to MahjHero')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Email me a sign-in link' }),
    ).toBeTruthy();
  });
});
