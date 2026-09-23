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
import { GENERIC_ERROR } from '../lib/constants';
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
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // One in-flight auth attempt at a time, whichever route started it. On
  // native `openAuthSessionAsync` takes seconds, and a second tap opens a
  // second auth session on top of the first.
  const busy = status === 'sending' || verifying || resending || pendingProvider !== null;

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
    setResending(true);
    const { error: sendError } = await sendSignInCode(email);
    setResending(false);
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
    // Wrong and expired codes return the same generic message from GoTrue, so
    // there is nothing more specific to tell them apart by -- one fixed message
    // covers both rather than surfacing that raw wording. A genuine connection
    // failure is a different problem, not a bad code, so it keeps its own
    // message instead of being folded into the same one.
    if (verifyError === GENERIC_ERROR) {
      setError(GENERIC_ERROR);
    } else if (verifyError) {
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
        <View style={styles.codeFieldWrap}>
          <TextField
            label="Sign-in code"
            value={code}
            onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 12))}
            placeholder="123456"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            autoCorrect={false}
            onSubmitEditing={onVerify}
            accessibilityLabel="Sign-in code"
          />
        </View>
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
          loading={resending}
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
  codeFieldWrap: {
    alignSelf: 'stretch',
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
