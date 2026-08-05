import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { availableProviders, isValidEmail, sendMagicLink, signInWithProvider } from '../lib/auth';
import type { OAuthProvider } from '../lib/auth';

export default function SignIn() {
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

  if (status === 'sent') {
    return (
      <View style={styles.container}>
        <Text style={styles.heading}>Check your email</Text>
        <Text style={styles.body}>
          We sent a sign-in link to {email.trim()}. Open it on this device.
        </Text>
        {/* Without this the screen is a one-way door: a member who mistyped
            their address has no route back short of force-quitting the app. */}
        <Pressable
          style={styles.providerButton}
          onPress={() => setStatus('idle')}
          accessibilityRole="button"
        >
          <Text style={styles.providerButtonText}>Use a different address</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Sign in to MahjHero</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        accessibilityLabel="Email address"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        style={[styles.button, busy ? styles.buttonDisabled : null]}
        onPress={onSubmit}
        disabled={busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy, busy: status === 'sending' }}
      >
        {status === 'sending' ? (
          <ActivityIndicator accessibilityLabel="Sending your sign-in link" />
        ) : (
          <Text style={styles.buttonText}>Email me a sign-in link</Text>
        )}
      </Pressable>
      <Text style={styles.divider}>or</Text>
      {availableProviders(Platform.OS).map((provider) => (
        <Pressable
          key={provider}
          style={[styles.providerButton, busy ? styles.providerButtonDisabled : null]}
          onPress={() => onProviderPress(provider)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{
            disabled: busy,
            busy: pendingProvider === provider,
          }}
        >
          {pendingProvider === provider ? (
            <ActivityIndicator
              accessibilityLabel={`Opening ${provider === 'google' ? 'Google' : 'Apple'} sign-in`}
            />
          ) : (
            <Text style={styles.providerButtonText}>
              Continue with {provider === 'google' ? 'Google' : 'Apple'}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  heading: { fontSize: 28, fontWeight: '600' },
  body: { fontSize: 18, lineHeight: 26 },
  input: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 16,
    fontSize: 18,
  },
  button: {
    backgroundColor: '#1f6feb',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#9db8e8' },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  error: { color: '#b3261e', fontSize: 18 },
  // The brief specified fontSize: 16 for the divider, but this app's
  // 18pt minimum body-text floor (older player base) applies to all
  // visible text, so it is raised to 18 here.
  divider: { textAlign: 'center', fontSize: 18, color: '#666' },
  providerButton: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 18,
    alignItems: 'center',
  },
  providerButtonDisabled: { borderColor: '#ccc' },
  providerButtonText: { fontSize: 18, fontWeight: '600' },
});
