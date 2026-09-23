import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

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

let sessionResult: { session: unknown; loading: boolean } = {
  session: null,
  loading: false,
};
vi.mock('../../lib/session', () => ({
  useSession: () => sessionResult,
}));

// Mocked whole rather than partially: lib/auth pulls in expo-auth-session,
// expo-web-browser and expo-linking, none of which resolve under Vitest, and
// none of which this test exercises.
vi.mock('../../lib/auth', () => ({
  availableProviders: () => ['google'],
  isValidEmail: (value: string) => value.includes('@'),
  sendSignInCode: vi.fn(async () => ({ error: null })),
  verifySignInCode: vi.fn(async () => ({ error: null })),
  signInWithProvider: vi.fn(async () => ({ error: null })),
}));

import { sendSignInCode, verifySignInCode } from '../../lib/auth';
import SignIn from '../sign-in';

/**
 * Fills the email field and submits it, landing on the code-entry step.
 *
 * Flushes with `vi.advanceTimersByTimeAsync(0)` rather than
 * `screen.findByText(...)` (Testing Library's own async queries), because
 * the resend-cooldown test below needs fake timers installed from before
 * `render` — the countdown's `setInterval` must itself be a fake timer, or
 * `vi.advanceTimersByTime` later has nothing real to advance (a timer
 * created under real timers stays real even after `vi.useFakeTimers()`
 * switches the global on). `findByText`'s internal retry loop polls via a
 * *real* `setTimeout` regardless, so it hangs forever once fake timers are
 * active. The advance only runs when fake timers are actually installed
 * (checked via `vi.isFakeTimers()`) — calling it under real timers throws.
 * When real timers are in effect, `act`'s own async handling is what waits
 * for the mocked `sendSignInCode` promise to settle.
 */
async function sendCode(email = 'jane@example.com') {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: email },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }));
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(0);
    }
  });
}

describe('sign-in screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canGoBackResult = true;
    sessionResult = { session: null, loading: false };
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('still offers the email code form', () => {
    render(<SignIn />);
    expect(screen.getByText('Sign in to MahjHero')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Email me a sign-in code' }),
    ).toBeTruthy();
  });

  it('moves to the code-entry step after sending a code', async () => {
    render(<SignIn />);
    await sendCode('jane@example.com');
    expect(sendSignInCode).toHaveBeenCalledWith('jane@example.com');
    expect(screen.getByText('Enter your code')).toBeTruthy();
  });

  it('verifies the entered code', async () => {
    render(<SignIn />);
    await sendCode('jane@example.com');

    fireEvent.change(screen.getByLabelText('Sign-in code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    expect(verifySignInCode).toHaveBeenCalledWith('jane@example.com', '123456');
  });

  it('shows one fixed message for a wrong or expired code', async () => {
    vi.mocked(verifySignInCode).mockResolvedValueOnce({
      error: 'Token has expired or is invalid',
    });
    render(<SignIn />);
    await sendCode('jane@example.com');

    fireEvent.change(screen.getByLabelText('Sign-in code'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    await screen.findByText(
      "That code didn't work — check it or request a new one.",
    );
  });

  it('disables resend for 60 seconds, then re-enables it', async () => {
    // Fake timers go on BEFORE render, not after sendCode -- the countdown's
    // setInterval is created as soon as the code-entry step mounts, and a
    // timer created under real timers is invisible to vi.advanceTimersByTime
    // even after switching to fake ones (see sendCode's docstring above).
    vi.useFakeTimers();
    render(<SignIn />);
    await sendCode('jane@example.com');

    const resend = screen.getByRole('button', { name: /Resend code/ });
    expect(resend.getAttribute('aria-disabled')).toBe('true');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Not .toBe('false'): react-native-web omits aria-disabled entirely
    // rather than rendering the literal string "false" once the control is
    // enabled again -- confirmed by inspecting the DOM directly, not assumed.
    expect(resend.getAttribute('aria-disabled')).toBeNull();
  });

  it('resends the code once the cooldown expires', async () => {
    vi.useFakeTimers();
    render(<SignIn />);
    await sendCode('jane@example.com');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resend code' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(sendSignInCode).toHaveBeenCalledTimes(2);
    expect(sendSignInCode).toHaveBeenLastCalledWith('jane@example.com');
  });

  it('redirects once a session exists', () => {
    sessionResult = { session: { user: { id: 'u1' } }, loading: false };
    render(<SignIn />);
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/');
  });

  it('returns to the email step from "Use a different email"', async () => {
    render(<SignIn />);
    await sendCode('jane@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(
      screen.getByRole('button', { name: 'Email me a sign-in code' }),
    ).toBeTruthy();
  });
});
