import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';
import Screen from '../components/Screen';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

/**
 * Decides where a visit to "/" should land: a signed-out visitor gets the
 * welcome screen, a signed-in one gets their clubs. Extracted as a pure
 * function — rather than inlined in the component below — so the branching
 * is directly testable without rendering or mocking the router. See
 * `app/__tests__/index.test.ts`.
 *
 * Returns `null` while the answer isn't decided yet (auth still loading) —
 * the caller shows a spinner in that case rather than redirecting anywhere.
 */
export function resolveIndexRedirect(
  loading: boolean,
  hasSession: boolean,
): string | null {
  if (loading) return null;
  if (hasSession) return '/clubs';
  return '/welcome';
}

export default function Index() {
  const { session, loading } = useSession();

  const redirect = resolveIndexRedirect(loading, !!session);

  if (redirect === null) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  return <Redirect href={redirect} />;
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
  },
});
