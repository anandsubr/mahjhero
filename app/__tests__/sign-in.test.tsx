import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
// Controllable per test: canGoBack() varies between the warm-navigation
// case (visited /sign-in via welcome's CTAs) and the cold-start case
// (/sign-in loaded directly, e.g. from a deep link).
let canGoBackResult = true;
const canGoBack = vi.fn(() => canGoBackResult);

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push, replace, back, canGoBack }),
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
  beforeEach(() => {
    vi.clearAllMocks();
    canGoBackResult = true;
  });

  // Sign-in is now a step inside the welcome screen rather than the app's
  // front door, so it needs a way back to it. Welcome's two CTAs push here,
  // and back() reuses that existing history entry instead of appending one
  // — measuring the real web build showed replace() alone still let
  // history.length climb 3 -> 4 -> 5 across three round trips, because
  // replace lands on the last entry and the next push still appends.
  it('goes back when the router can go back', () => {
    canGoBackResult = true;
    render(<SignIn />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to the welcome screen' }),
    );
    expect(canGoBack).toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  // Cold start: /sign-in reached directly (it's linkable, and other screens
  // redirect straight to it) with nothing to go back to. back() would have
  // nowhere to land, so this falls back to replace(), which always lands
  // somewhere real.
  it('replaces with /welcome when the router cannot go back', () => {
    canGoBackResult = false;
    render(<SignIn />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to the welcome screen' }),
    );
    expect(canGoBack).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/welcome');
    expect(back).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('still offers the magic-link form', () => {
    render(<SignIn />);
    expect(screen.getByText('Sign in to MahjHero')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Email me a sign-in link' }),
    ).toBeTruthy();
  });
});
