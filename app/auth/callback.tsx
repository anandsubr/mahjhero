import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import { useSession } from '../../lib/session';
import { colors, space, type } from '../../lib/theme';

/**
 * Where a magic link or OAuth redirect lands on the web.
 *
 * `sendMagicLink` and `signInWithProvider` both set their redirect to
 * `Linking.createURL('auth/callback')`. On native that URL is intercepted —
 * by `openAuthSessionAsync` for OAuth, or by the root deep-link handler for a
 * link tapped in Mail — so no screen ever renders. On the web the browser
 * genuinely navigates here, and expo-router routes by file, so this route has
 * to exist or the member sees a 404 instead of being signed in.
 *
 * The session itself arrives without our help: `lib/supabase.ts` sets
 * `detectSessionInUrl` on web, so supabase-js parses the tokens out of the URL
 * fragment during client init. This screen only waits for that to land and
 * then gets out of the way.
 */

/**
 * How long to keep waiting after the session provider reports "not signed in".
 *
 * `getSession()` can resolve before supabase-js has finished parsing the URL
 * fragment, which would bounce a member who is about to be signed in straight
 * back to the sign-in screen. Waiting briefly costs a moment on a genuinely
 * failed link and prevents a wrong answer on a good one.
 */
const SETTLE_MS = 1500;

export default function AuthCallback() {
  const { session, loading } = useSession();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (session) return <Redirect href="/profile" />;

  if (!loading && settled) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Screen>
      <View style={styles.centered}>
        <ActivityIndicator
          color={colors.accentColor}
          accessibilityLabel="Signing you in"
        />
        <Text style={styles.message}>Signing you in…</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingVertical: space[8],
  },
  message: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
});
