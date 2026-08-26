import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import ErrorBanner from '../components/ErrorBanner';
import { ChevronLeftIcon, MailIcon } from '../components/icons';
import Screen from '../components/Screen';
import TextField from '../components/TextField';
import { availableProviders, isValidEmail, sendMagicLink, signInWithProvider } from '../lib/auth';
import type { OAuthProvider } from '../lib/auth';
import { useSession } from '../lib/session';
import { colors, space, type } from '../lib/theme';

const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: 'Continue with Google',
  apple: 'Continue with Apple',
};

export default function SignIn() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [pendingProvider, setPendingProvider] = useState<OAuthProvider | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // One in-flight auth attempt at a time, whichever route started it. On
  // native `openAuthSessionAsync` takes seconds, and a second tap opens a
  // second auth session on top of the first.
  const busy = status === 'sending' || pendingProvider !== null;

  async function onSubmit() {
    if (busy) return;
    if (!isValidEmail(email)) {
      setError('Please check that email address.');
      return;
    }
    setError(null);
    setStatus('sending');
    const { error: sendError } = await sendMagicLink(email);
    if (sendError) {
      setError(sendError);
      setStatus('idle');
      return;
    }
    setStatus('sent');
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

  // This screen has to watch the session itself. app/index.tsx doesn't
  // remount to react to a session appearing here — it has already unmounted
  // by the time anyone is standing on this screen.
  //
  // Warm path: the member is on "Check your email", taps the link, the app
  // foregrounds, useAuthDeepLink establishes the session — and without this
  // the screen would go on saying "Check your email" forever. Cold path: the
  // link launches the app, index.tsx resolves a null session first and sends
  // the member here, and the session then lands on a screen not watching for
  // it. Web hid both, because there the redirect is a fresh page load through
  // index.tsx.
  //
  // It fixes the same latent gap for OAuth, which never navigated either.
  //
  // Redirects to "/" rather than a fixed destination: app/index.tsx is the
  // one place that knows whether this member has a pending club invite
  // parked (see PENDING_INVITE_KEY) and must be sent to `/join/<token>`
  // instead of `/clubs`. Hard-coding a destination here would either strand
  // that invite (as `/profile` did) or duplicate index's decision.
  if (!loading && session) return <Redirect href="/" />;

  if (status === 'sent') {
    return (
      <Screen center contentStyle={styles.checkContent}>
        <View style={styles.mailWell}>
          <MailIcon />
        </View>
        <Text style={styles.heading}>Check your email</Text>
        <Text style={styles.body}>
          We sent a sign-in link to <Text style={styles.bodyStrong}>{email.trim()}</Text>. Open it
          on this device and you're in.
        </Text>
        {/* The design's mock also shows an "I opened the link" button, but
            in the real app the redirect to /profile happens automatically
            once useAuthDeepLink establishes the session (see the redirect
            above) — there is nothing left for a manual button to do, so it
            is omitted rather than shipped as a dead control.
            "Use a different email" is real: without it the screen is a
            one-way door for a member who mistyped their address, with no
            route back short of force-quitting the app. */}
        <Button variant="ghost" big={false} onPress={() => setStatus('idle')}>
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
          same chevron. */}
      <Button
        variant="ghost"
        big={false}
        onPress={() => router.push('/welcome')}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        accessibilityLabel="Back to the welcome screen"
        style={styles.backButton}
      >
        Back
      </Button>
      <Text style={styles.heading}>Sign in to MahjHero</Text>
      <Text style={styles.body}>
        No password to remember. We'll email you a link that signs you straight in.
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
        accessibilityLabel="Email me a sign-in link"
      >
        Email me a sign-in link
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
