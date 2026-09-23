# Email Sign-In: Magic Link → OTP Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MahjHero's clickable magic-link email sign-in with a typed one-time code, on both web and native, so that sign-in and invite redemption no longer depend on two separate taps landing in the same browser storage.

**Architecture:** `lib/auth.ts`'s `sendMagicLink` is renamed `sendSignInCode` and stops requesting a redirect URL (there is no link to redirect from anymore); a new `verifySignInCode(email, code)` wraps `supabase.auth.verifyOtp`. `app/sign-in.tsx`'s status state machine gains a `code-entry` step in place of today's terminal `sent` state, with a code field, a Verify button, and a 60-second-gated Resend. Verifying a code sets the session directly in the same already-mounted screen (via the existing `onAuthStateChange` subscription in `lib/session.ts`), so the screen's existing `if (!loading && session) return <Redirect href="/" />` fires in place — no navigation, no second browser context, and `app/join/[token].tsx`'s invite-parking mechanism needs no changes at all. OAuth (Google/Apple) is untouched.

**Tech Stack:** Expo Router, React Native (+ react-native-web), `@supabase/supabase-js` (`signInWithOtp` / `verifyOtp`), Vitest + `@testing-library/react`.

## Global Constraints

- No changes to `app/join/[token].tsx`, `app/index.tsx`, or `lib/session.ts` — the spec confirms these don't need to change.
- The code field must not hard-assume a specific digit count in validation logic (only a generous `maxLength={8}` cap) — Supabase's `auth.email.otp_length` for mahjhero-dev may be 6 or 8 depending on whether Task 4 has landed yet, and the UI must work correctly either way.
- `verifySignInCode`'s error is never shown verbatim to the user; the sign-in screen always shows one fixed message for any code failure, per the spec ("both map to a single message").
- Every async auth function in `lib/auth.ts` must never reject (catch + return `{ error: GENERIC_ERROR }`), matching every existing function in that file.
- Match existing test conventions exactly: `vi.mock('../../lib/auth', ...)` whole-module mocks in `app/__tests__/sign-in.test.tsx`, `fireEvent.change(screen.getByLabelText(...), { target: { value } })` for text input, `await screen.findByText(...)` for assertions after an async state update, and `vi.useFakeTimers()` / `act(() => vi.advanceTimersByTime(...))` / `vi.useRealTimers()` (mirroring `components/__tests__/RoundTimer.test.tsx`) for the resend countdown — never combine fake timers with `findBy*`/`waitFor` in the same window, since Testing Library's async queries poll via real timers internally and will hang under a faked clock.

---

### Task 1: `lib/auth.ts` — rename to `sendSignInCode`, add `verifySignInCode`

**Files:**
- Modify: `lib/auth.ts:1-45` (imports + `sendMagicLink`)
- Modify: `lib/auth.test.ts:1-74` (mock + `sendMagicLink` describe block)
- Modify: `lib/profile.ts:56` (comment only)
- Modify: `app/__tests__/redirect-routes.test.ts:12` (comment only)

**Interfaces:**
- Produces: `sendSignInCode(email: string): Promise<{ error: string | null }>`, `verifySignInCode(email: string, code: string): Promise<{ error: string | null }>` — both used by Task 2.

- [ ] **Step 1: Write the failing tests**

Replace the `sendMagicLink` describe block in `lib/auth.test.ts` (currently lines 56-74) with:

```ts
describe('sendSignInCode', () => {
  it('resolves with an error instead of rejecting when the underlying call throws', async () => {
    await expect(sendSignInCode('jane@example.com')).resolves.toEqual({
      error: 'Could not reach MahjHero. Check your connection and try again.',
    });
  });

  it('trims the email before sending', async () => {
    await sendSignInCode('  jane@example.com  ');
    expect(supabase.auth.signInWithOtp).toHaveBeenLastCalledWith({
      email: 'jane@example.com',
    });
  });
});

describe('verifySignInCode', () => {
  it('resolves with an error instead of rejecting when the underlying call throws', async () => {
    await expect(verifySignInCode('jane@example.com', '123456')).resolves.toEqual({
      error: 'Could not reach MahjHero. Check your connection and try again.',
    });
  });

  it('trims the email and passes the code through to verifyOtp', async () => {
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValueOnce({
      data: { session: null, user: null },
      error: null,
    } as never);
    await verifySignInCode('  jane@example.com  ', '123456');
    expect(supabase.auth.verifyOtp).toHaveBeenLastCalledWith({
      email: 'jane@example.com',
      token: '123456',
      type: 'email',
    });
  });

  it('surfaces a failed verification as an error', async () => {
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: 'Token has expired or is invalid' },
    } as never);
    await expect(verifySignInCode('jane@example.com', '000000')).resolves.toEqual({
      error: 'Token has expired or is invalid',
    });
  });
});
```

Also update the top-of-file mock (currently lines 1-30) to add `verifyOtp` and drop the now-unneeded `expo-linking` stub's role in this describe block (it's still needed for `signInWithProvider`, so keep the `vi.mock('expo-linking', ...)` block as-is — only the `supabase` mock and the import line change):

```ts
vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: vi.fn().mockRejectedValue(new Error('network down')),
      verifyOtp: vi.fn().mockRejectedValue(new Error('network down')),
      signInWithOAuth: vi.fn().mockRejectedValue(new Error('network down')),
      setSession: vi.fn(),
    },
  },
}));
```

And change the import line (currently line 30) to:

```ts
import { availableProviders, isValidEmail, sendSignInCode, signInWithProvider, verifySignInCode } from './auth';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/auth.test.ts`
Expected: FAIL — `sendSignInCode is not a function` / `verifySignInCode is not a function` (neither is exported yet).

- [ ] **Step 3: Implement `sendSignInCode` and `verifySignInCode`**

In `lib/auth.ts`, replace the `sendMagicLink` function (lines 23-45) with:

```ts
/**
 * Never rejects. A function declared as returning `{ error }` must report
 * failure through that channel, not by throwing — the sign-in screen sets
 * its status to "sending" before calling this, and an escaping rejection
 * would strand the user in a spinner with the submit button disabled and
 * no message explaining why.
 *
 * No `emailRedirectTo` — there is no clickable link in this email anymore
 * (see docs/superpowers/specs/2026-09-23-otp-sign-in-design.md), only a
 * typed code, so there is nothing to redirect from.
 */
export async function sendSignInCode(
  email: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
    });
    return { error: error ? error.message : null };
  } catch (cause) {
    // The user-facing message is deliberately generic, but keep the original
    // for diagnosis — otherwise a DNS failure, a Supabase outage, and a CORS
    // misconfiguration are indistinguishable from the outside.
    console.error('sendSignInCode failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/**
 * Never rejects, for the same reason as sendSignInCode above.
 *
 * A failure here can mean a wrong code or an expired one — GoTrue returns
 * the same generic error either way, so this passes the message through
 * unfiltered; it's the sign-in screen's job (not this function's) to
 * collapse it to one fixed, user-facing string rather than show GoTrue's
 * wording directly.
 */
export async function verifySignInCode(
  email: string,
  code: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });
    return { error: error ? error.message : null };
  } catch (cause) {
    console.error('verifySignInCode failed', cause);
    return { error: GENERIC_ERROR };
  }
}
```

Leave every other function in `lib/auth.ts` (`isValidEmail`, `completeAuthRedirect`, `availableProviders`, `signInWithProvider`) untouched — they're unaffected by this change (`completeAuthRedirect` is still used by OAuth).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/auth.test.ts`
Expected: PASS, all tests in the file including the new `sendSignInCode` and `verifySignInCode` describe blocks.

- [ ] **Step 5: Fix the two stale comment references**

In `lib/profile.ts`, in the docstring directly above `updateProfile` (currently line 56), change:

```ts
/**
 * Never rejects, for the same reason as sendMagicLink in lib/auth.ts: the
```

to:

```ts
/**
 * Never rejects, for the same reason as sendSignInCode in lib/auth.ts: the
```

In `app/__tests__/redirect-routes.test.ts`, in the file's top docstring (currently line 12), change:

```ts
 * This is not hypothetical. `sendMagicLink` gained
```

to:

```ts
 * This is not hypothetical. The function now called `sendSignInCode`
 * (then `sendMagicLink`) gained
```

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: PASS. (`app/__tests__/sign-in.test.tsx` will fail here — it still imports `sendMagicLink` — that's fixed in Task 2, not this one.)

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts lib/auth.test.ts lib/profile.ts app/__tests__/redirect-routes.test.ts
git commit -m "$(cat <<'EOF'
feat(auth): replace sendMagicLink with sendSignInCode + verifySignInCode

Prepares lib/auth.ts for OTP-code sign-in: sendSignInCode no longer
requests a redirect URL (there is no link to redirect from), and
verifySignInCode wraps supabase.auth.verifyOtp. app/sign-in.tsx is
updated in the next commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `app/sign-in.tsx` — code-entry step

**Files:**
- Modify: `app/sign-in.tsx` (full rewrite of the component body; imports, styles, and the OAuth section are mostly unchanged)
- Modify: `app/__tests__/sign-in.test.tsx`
- Modify: `app/auth/callback.tsx:1-25` (docstring only)

**Interfaces:**
- Consumes: `sendSignInCode`, `verifySignInCode` from Task 1 (exact signatures above).

- [ ] **Step 1: Write the failing tests**

Replace `app/__tests__/sign-in.test.tsx` in full with:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: null, loading: false }),
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

/** Fills the email field and submits it, landing on the code-entry step. */
async function sendCode(email = 'jane@example.com') {
  fireEvent.change(screen.getByLabelText('Email address'), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in code' }));
  await screen.findByText('Enter your code');
}

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
    render(<SignIn />);
    await sendCode('jane@example.com');

    // Fake timers are only switched on now, after the async send above has
    // already settled — Testing Library's findBy*/waitFor poll via real
    // timers internally and hang forever under a faked clock, so the two
    // must never overlap in the same window (see components/__tests__/
    // RoundTimer.test.tsx for the same pattern).
    vi.useFakeTimers();
    const resend = screen.getByRole('button', { name: /Resend code/ });
    expect(resend.getAttribute('aria-disabled')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(resend.getAttribute('aria-disabled')).toBe('false');
    vi.useRealTimers();
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/__tests__/sign-in.test.tsx`
Expected: FAIL — the mock factory no longer matches `sign-in.tsx`'s current imports (`sendMagicLink`), and none of the new code-entry UI exists yet.

- [ ] **Step 3: Rewrite `app/sign-in.tsx`**

Replace the file in full with:

```tsx
import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import ErrorBanner from '../components/ErrorBanner';
import { ChevronLeftIcon, MailIcon } from '../components/icons';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import {
  availableProviders,
  isValidEmail,
  sendSignInCode,
  signInWithProvider,
  verifySignInCode,
} from '../lib/auth';
import type { OAuthProvider } from '../lib/auth';
import { useSession } from '../lib/session';
import { colors, space, type } from '../lib/theme';

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: 'Continue with Google',
  apple: 'Continue with Apple',
};

/**
 * Seconds a member must wait before "Resend code" works again, matching
 * mahjhero-dev's `auth.email.max_frequency` (1 minute) — a second send
 * within that window fails at Supabase anyway, so this avoids letting a tap
 * through only to show a rate-limit error.
 */
const RESEND_COOLDOWN_SECONDS = 60;

export default function SignIn() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'code-entry'>('idle');
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // One in-flight auth attempt at a time, whichever route started it. On
  // native `openAuthSessionAsync` takes seconds, and a second tap opens a
  // second auth session on top of the first.
  const busy = status === 'sending' || verifying || pendingProvider !== null;

  // Ticks the resend cooldown down to zero once a second. Re-created every
  // tick (the dependency is the count itself) rather than once at 60 — a
  // single interval started at mount would need its own elapsed-time
  // bookkeeping to survive a re-render, and this is the same shape as every
  // other live countdown in this app (see components/RoundTimer.tsx).
  useEffect(() => {
    if (resendCooldown === 0) return;
    const timer = setInterval(() => {
      setResendCooldown((seconds) => (seconds <= 1 ? 0 : seconds - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  async function onSubmit() {
    if (busy) return;
    if (!isValidEmail(email)) {
      setError('Please check that email address.');
      return;
    }
    setError(null);
    setStatus('sending');
    const { error: sendError } = await sendSignInCode(email);
    if (sendError) {
      setError(sendError);
      setStatus('idle');
      return;
    }
    setCode('');
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setStatus('code-entry');
  }

  async function onResend() {
    if (busy || resendCooldown > 0) return;
    setError(null);
    const { error: sendError } = await sendSignInCode(email);
    if (sendError) {
      setError(sendError);
      return;
    }
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function onVerify() {
    if (busy || !code.trim()) return;
    setError(null);
    setVerifying(true);
    const { error: verifyError } = await verifySignInCode(email, code.trim());
    setVerifying(false);
    // Wrong and expired codes return the same generic message from GoTrue,
    // so there is nothing more specific to tell them apart by — one fixed
    // message covers both rather than surfacing that raw wording.
    if (verifyError) {
      setError("That code didn't work — check it or request a new one.");
    }
    // On success there is nothing further to do here: verifySignInCode sets
    // the session in this same mounted screen (lib/session.ts's
    // onAuthStateChange subscription picks it up), and the redirect below
    // fires in place.
  }

  function onUseDifferentEmail() {
    setStatus('idle');
    setCode('');
    setError(null);
  }

  async function onProviderPress(provider: OAuthProvider) {
    if (busy) return;
    // Clear any prior error before starting, exactly as onSubmit does —
    // otherwise a stale message sits under a button that is now working.
    setError(null);
    setPendingProvider(provider);
    try {
      const { error: providerError } = await signInWithProvider(provider);
      if (providerError) setError(providerError);
    } finally {
      setPendingProvider(null);
    }
  }

  // This screen has to watch the session itself: verifying a code sets the
  // session directly in this same mounted screen (see verifySignInCode
  // above), so nothing else re-renders to notice it arrived. OAuth still has
  // a warm/cold deep-link dimension of its own — the redirect can land here
  // cold, or resolve while this screen is already showing — and either way
  // nothing else is watching for that one either.
  //
  // Redirects to "/" rather than a fixed destination: app/index.tsx is the
  // one place that knows whether this member has a pending club invite
  // parked (see PENDING_INVITE_KEY) and must be sent to `/join/<token>`
  // instead of `/clubs`. Hard-coding a destination here would either strand
  // that invite (as `/profile` did) or duplicate index's decision.
  if (!loading && session) return <Redirect href="/" />;

  if (status === 'code-entry') {
    return (
      <Screen center contentStyle={styles.checkContent}>
        <View style={styles.mailWell}>
          <MailIcon />
        </View>
        <Text style={styles.heading}>Enter your code</Text>
        <Text style={styles.body}>
          We sent a sign-in code to <Text style={styles.bodyStrong}>{email.trim()}</Text>. Enter
          it below.
        </Text>
        <TextField
          label="Sign-in code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          autoCorrect={false}
          maxLength={8}
          accessibilityLabel="Sign-in code"
        />
        {error ? <ErrorBanner message={error} /> : null}
        <Button
          variant="primary"
          block
          onPress={onVerify}
          disabled={busy || !code.trim()}
          loading={verifying}
          accessibilityLabel="Verify code"
        >
          Verify code
        </Button>
        <Button
          variant="ghost"
          big={false}
          onPress={onResend}
          disabled={busy || resendCooldown > 0}
          accessibilityLabel="Resend code"
        >
          {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
        </Button>
        {/* Without this, a member who mistyped their address is stuck here
            with no way back short of force-quitting the app. */}
        <Button variant="ghost" big={false} onPress={onUseDifferentEmail}>
          Use a different email
        </Button>
      </Screen>
    );
  }

  const providers = availableProviders(Platform.OS);

  return (
    <Screen center contentStyle={styles.content}>
      {/* Sign-in is a step inside the welcome screen now, not the app's
          front door, so it needs a way back to it. The artboard draws this
          same chevron.

          `back()`, not `replace`: welcome's two CTAs push here, and back()
          reuses that existing history entry instead of appending a new one.
          `replace` alone doesn't bound the stack — driving the real web
          build across three welcome→sign-in→welcome round trips showed
          history.length climbing 3 -> 4 -> 5, because replace lands on the
          last entry and the next push still appends, filling the stack with
          duplicate /welcome entries.

          `canGoBack()` guards the cold-start case: /sign-in is reachable
          directly (the route is linkable, and other screens redirect
          straight to it), where back() has nowhere to go. `replace` always
          lands somewhere real, so it's the fallback when there's nothing to
          go back to. */}
      <Button
        variant="ghost"
        big={false}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        accessibilityLabel="Back to the welcome screen"
        style={styles.backButton}
      >
        Back
      </Button>
      <Text style={styles.heading}>Sign in to MahjHero</Text>
      <Text style={styles.body}>
        No password to remember. We'll email you a one-time code that signs you straight in.
      </Text>
      <TextField
        label="Email address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        accessibilityLabel="Email address"
      />
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        variant="primary"
        block
        onPress={onSubmit}
        disabled={busy}
        loading={status === 'sending'}
        accessibilityLabel="Email me a sign-in code"
      >
        Email me a sign-in code
      </Button>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>
      <View style={styles.providerGroup}>
        {providers.map((provider) => (
          <Button
            key={provider}
            variant={provider === 'apple' ? 'dark' : 'secondary'}
            block
            onPress={() => onProviderPress(provider)}
            disabled={busy}
            loading={pendingProvider === provider}
            accessibilityLabel={PROVIDER_LABEL[provider]}
          >
            {PROVIDER_LABEL[provider]}
          </Button>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: space[6],
    gap: space[4],
  },
  checkContent: {
    alignItems: 'flex-start',
    padding: space[6],
    gap: space[5],
  },
  mailWell: {
    width: 72,
    height: 96,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h1,
    color: colors.text,
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.bodyLarge,
    lineHeight: 28,
    color: colors.textMuted,
  },
  bodyStrong: {
    fontFamily: type.bodyBold,
    color: colors.text,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.divider,
  },
  dividerText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  providerGroup: {
    gap: space[3],
  },
  backButton: {
    alignSelf: 'flex-start',
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/__tests__/sign-in.test.tsx`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Update `app/auth/callback.tsx`'s docstring**

This route is now OAuth-only — email sign-in no longer redirects anywhere. Replace the file's top docstring (currently lines 1-25) with:

```tsx
/**
 * Where an OAuth (Google/Apple) redirect lands on the web.
 *
 * `signInWithProvider` sets its redirect to
 * `Linking.createURL('auth/callback')`. On native that URL is intercepted by
 * `openAuthSessionAsync`, so no screen ever renders. On the web the browser
 * genuinely navigates here, and expo-router routes by file, so this route
 * has to exist or the member sees a 404 instead of being signed in.
 *
 * Email sign-in no longer redirects anywhere: verifying a one-time code
 * (`verifySignInCode` in `lib/auth.ts`) completes in whichever screen is
 * already showing the code-entry step, with no browser navigation involved.
 * This route exists purely for OAuth now.
 *
 * The session itself arrives without our help: `lib/supabase.ts` sets
 * `detectSessionInUrl` on web, so supabase-js parses the tokens out of the URL
 * fragment during client init. This screen only waits for that to land and
 * then gets out of the way.
 *
 * Getting out of the way means redirecting to "/", not to a fixed screen:
 * `app/index.tsx` is the one place that knows whether this member has a club
 * invite parked (see `PENDING_INVITE_KEY` in `app/join/[token].tsx`) and must
 * land on `/join/<token>` rather than `/clubs`. This screen only knows a
 * session arrived, not where it should lead.
 */
```

Leave the rest of the file (the `SETTLE_MS` constant and the component itself) untouched.

- [ ] **Step 6: Run the full test suite and typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: both PASS with no errors.

- [ ] **Step 7: Commit**

```bash
git add app/sign-in.tsx app/__tests__/sign-in.test.tsx app/auth/callback.tsx
git commit -m "$(cat <<'EOF'
feat(auth): sign in with a typed code instead of a tapped link

Verifying a code completes in the same screen that requested it, so
sign-in and club-invite redemption no longer depend on two taps
landing in the same browser storage -- the bug an SFSafariViewController
in-app browser (confirmed for Yahoo Mail's iOS app) made unavoidable.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update the two Supabase email templates

**Files:** none in this repo — both templates live only in the Supabase dashboard for the `mahjhero-dev` project (`rzutuhabxzcateutaojo`), per this session's earlier work (see the "Email template changes" section of the design spec).

**Interfaces:** none — this task has no code dependency on Tasks 1-2 and can be done in any order relative to them, but the code in Task 2 assumes members are receiving a code-first email, so ship this close together with Task 2 in practice.

- [ ] **Step 1: Replace the "Magic Link" template**

In the Supabase dashboard for `mahjhero-dev`: **Authentication → Email Templates → Magic Link**. Replace its body with:

```html
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Your MahjHero sign-in code</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;600;700&display=swap" rel="stylesheet">
<!--[if mso]>
<style>
  * { font-family: Georgia, 'Times New Roman', serif !important; }
</style>
<![endif]-->
<style>
  body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  body { margin: 0; padding: 0; width: 100% !important; background-color: #f5ead8; }
  a { text-decoration: none; }

  .brand-eyebrow { font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .headline { font-family: 'Caprasimo', Georgia, 'Times New Roman', serif; }
  .body-copy, .footer-copy, .code-label { font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .code { font-family: Georgia, 'Times New Roman', serif; }

  @media screen and (max-width: 480px) {
    .container { width: 100% !important; }
    .card { padding: 32px 24px !important; }
    .headline { font-size: 26px !important; }
    .code { font-size: 32px !important; letter-spacing: 0.25em !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#f5ead8;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
    Your MahjHero sign-in code: {{ .Token }}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5ead8;">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <table role="presentation" class="container" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px; max-width:480px;">

          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <span class="brand-eyebrow" style="font-size:13px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#8c491a;">
                &#x1F004;&nbsp; MahjHero
              </span>
            </td>
          </tr>

          <tr>
            <td class="card" bgcolor="#fffaf1" style="background-color:#fffaf1; border-radius:20px; padding:44px 40px; border: 1px solid #ebddc5;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" class="headline" style="font-size:30px; line-height:1.25; color:#201e1d; padding-bottom:16px; font-weight:400;">
                    Your seat is ready
                  </td>
                </tr>
                <tr>
                  <td align="center" class="body-copy" style="font-size:16px; line-height:1.6; color:#676158; padding-bottom:28px;">
                    Enter this code in the app to sign in to MahjHero. No password needed.
                  </td>
                </tr>
                <tr>
                  <td align="center" class="code-label" style="font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#a19786; padding-bottom:8px;">
                    Your sign-in code
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom:8px;">
                    <div class="code" style="font-size:40px; font-weight:700; letter-spacing:0.35em; color:#201e1d; background-color:#f5ead8; border:1px solid #ebddc5; border-radius:16px; padding:20px 28px; display:inline-block;">
                      {{ .Token }}
                    </div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" class="footer-copy" style="font-size:13px; line-height:1.6; color:#a19786; padding: 20px 24px 4px;">
              This code expires shortly and can only be used once.
            </td>
          </tr>
          <tr>
            <td align="center" class="footer-copy" style="font-size:13px; line-height:1.6; color:#a19786; padding: 0 24px;">
              Didn't request this? You can safely ignore this email.
            </td>
          </tr>

          <tr>
            <td align="center" class="footer-copy" style="font-size:12px; color:#c0b6a5; padding-top:28px;">
              MahjHero &mdash; organize your mahjong nights, one table at a time.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>
```

Set the subject line to: `Your MahjHero sign-in code`

- [ ] **Step 2: Replace the "Confirm signup" template**

Same dashboard, **Authentication → Email Templates → Confirm signup**. Replace its body with:

```html
<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Confirm your MahjHero email</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Caprasimo&family=Figtree:wght@400;600;700&display=swap" rel="stylesheet">
<!--[if mso]>
<style>
  * { font-family: Georgia, 'Times New Roman', serif !important; }
</style>
<![endif]-->
<style>
  body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  body { margin: 0; padding: 0; width: 100% !important; background-color: #f5ead8; }
  a { text-decoration: none; }

  .brand-eyebrow { font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .headline { font-family: 'Caprasimo', Georgia, 'Times New Roman', serif; }
  .body-copy, .footer-copy, .code-label { font-family: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }
  .code { font-family: Georgia, 'Times New Roman', serif; }

  @media screen and (max-width: 480px) {
    .container { width: 100% !important; }
    .card { padding: 32px 24px !important; }
    .headline { font-size: 26px !important; }
    .code { font-size: 32px !important; letter-spacing: 0.25em !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#f5ead8;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
    Your MahjHero confirmation code: {{ .Token }}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5ead8;">
    <tr>
      <td align="center" style="padding: 40px 16px;">

        <table role="presentation" class="container" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px; max-width:480px;">

          <tr>
            <td align="center" style="padding-bottom: 24px;">
              <span class="brand-eyebrow" style="font-size:13px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:#8c491a;">
                &#x1F004;&nbsp; MahjHero
              </span>
            </td>
          </tr>

          <tr>
            <td class="card" bgcolor="#fffaf1" style="background-color:#fffaf1; border-radius:20px; padding:44px 40px; border: 1px solid #ebddc5;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" class="headline" style="font-size:30px; line-height:1.25; color:#201e1d; padding-bottom:16px; font-weight:400;">
                    Welcome to the table
                  </td>
                </tr>
                <tr>
                  <td align="center" class="body-copy" style="font-size:16px; line-height:1.6; color:#676158; padding-bottom:28px;">
                    Enter this code in the app to confirm your email and finish setting up your MahjHero account.
                  </td>
                </tr>
                <tr>
                  <td align="center" class="code-label" style="font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#a19786; padding-bottom:8px;">
                    Your confirmation code
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-bottom:8px;">
                    <div class="code" style="font-size:40px; font-weight:700; letter-spacing:0.35em; color:#201e1d; background-color:#f5ead8; border:1px solid #ebddc5; border-radius:16px; padding:20px 28px; display:inline-block;">
                      {{ .Token }}
                    </div>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <tr>
            <td align="center" class="footer-copy" style="font-size:13px; line-height:1.6; color:#a19786; padding: 20px 24px 4px;">
              This code expires shortly and can only be used once.
            </td>
          </tr>
          <tr>
            <td align="center" class="footer-copy" style="font-size:13px; line-height:1.6; color:#a19786; padding: 0 24px;">
              Didn't request this? You can safely ignore this email.
            </td>
          </tr>

          <tr>
            <td align="center" class="footer-copy" style="font-size:12px; color:#c0b6a5; padding-top:28px;">
              MahjHero &mdash; organize your mahjong nights, one table at a time.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>
```

Set the subject line to: `Your MahjHero confirmation code`

- [ ] **Step 3: Verify by sending yourself a real email**

Once Task 2 is deployed (this template change alone doesn't require Task 2 to be live, but testing end-to-end does): sign in with an email address that has never used MahjHero before, and confirm the "Confirm signup" template above renders correctly and shows a real code. Then sign in again with the same address and confirm the "Magic Link" template renders for the returning-user case. Note this step has no automated test — it's a manual, visual check against a live inbox, the same way the original branded templates were verified earlier in this project.

---

### Task 4: Drop `otp_length` from 8 to 6 on mahjhero-dev

**Files:** none — `supabase/config.toml:241` already declares `otp_length = 6` (it has for a while; it's the *hosted* `mahjhero-dev` project that's still at 8, per `supabase config diff`'s output confirmed earlier this session).

**Interfaces:** none — independent of every other task. The code field in Task 2 works correctly whether this has landed or not (it accepts up to 8 characters either way).

- [ ] **Step 1: Do NOT use `supabase config push` for this**

`supabase config push --help` warns explicitly: pushing local `config.toml` writes *every* property it declares to the linked project, and this repo's `config.toml` also declares several values that differ from mahjhero-dev's real, intentionally-customized settings (`site_url`, `additional_redirect_urls`, `enable_confirmations`, `mfa.totp.*`, `sms.twilio.enabled`, `db.pooler.*`, and more — confirmed via `npx supabase config diff` earlier this session). A blanket push would silently overwrite all of those with local development defaults, breaking production auth. Change `otp_length` by itself, directly in the dashboard, instead.

- [ ] **Step 2: Change it in the dashboard**

In the Supabase dashboard for `mahjhero-dev`: **Authentication → Providers → Email** (or **Authentication → Sign In / Providers**, depending on the current dashboard layout — look for "Email OTP" settings). Find the OTP length setting and change it from 8 to 6. Save.

- [ ] **Step 3: Verify with the existing read-only diff tool**

Run: `npx supabase config diff`
Expected: the `["auth","email","otp_length"]` entry (previously `{"local":6,"remote":8}`) no longer appears in the `changes` array — `local` and `remote` now agree. This command is read-only (confirmed by its own description: "Read-only: never modifies local or remote configuration"), so it's safe to run freely to check.

- [ ] **Step 4: No commit** — nothing in the repo changed for this task.

---

## Self-Review

**Spec coverage:**
- Decision 1 (both platforms, one code path) → Task 2's single `code-entry` state, no `Platform.OS` branch in the email flow. ✅
- Decision 2 (code-only, no link) → `sendSignInCode` drops `emailRedirectTo`; both templates drop the button/`{{ .ConfirmationURL }}`. ✅
- Decision 3 (invite-parking untouched) → Global Constraints explicitly forbids touching those three files; no task modifies them. ✅
- Decision 4 (6-digit code) → Task 4. ✅
- Architecture's exact function names/signatures → Task 1. ✅
- UI details (autofill hints, shared error message, no new route) → Task 2. ✅
- Email template changes → Task 3. ✅
- Testing section's five sign-in.tsx cases + `verifySignInCode` unit tests → Task 1 Step 1, Task 2 Step 1. ✅
- Out of scope (`app/join/[token].tsx`, `app/index.tsx`, OAuth) → confirmed untouched throughout. ✅

**Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code or an exact dashboard navigation instruction.

**Type consistency:** `sendSignInCode(email: string): Promise<{ error: string | null }>` and `verifySignInCode(email: string, code: string): Promise<{ error: string | null }>` are the same signatures in Task 1's implementation, Task 1's tests, and Task 2's imports/usage throughout.
