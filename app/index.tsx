import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import Screen from '../components/Screen';
import { PENDING_INVITE_KEY } from '../lib/clubs';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

/**
 * Decides where a visit to "/" should land, given the three pieces of state
 * that matter: a signed-out visitor gets the welcome screen, a signed-in one
 * gets their clubs — or a parked club invite, if they have one. Extracted as
 * a pure function — rather than inlined in the component below — so the
 * branching, especially the async race between a session appearing and the
 * pending-invite storage read finishing, is directly testable without
 * rendering, mocking the router, or racing real timers. See
 * `app/__tests__/index.test.ts`.
 *
 * Returns `null` while the answer isn't decided yet (auth still loading, or
 * signed in but the storage read hasn't resolved) — the caller shows a
 * spinner in that case rather than redirecting anywhere. Returning too early
 * here is exactly the bug this function exists to prevent: redirecting to
 * `/clubs` before the storage read resolves would flash past a real pending
 * invite.
 */
export function resolveIndexRedirect(
  loading: boolean,
  hasSession: boolean,
  pendingInvite: string | null | undefined,
): string | null {
  if (loading || (hasSession && pendingInvite === undefined)) return null;
  if (hasSession) return pendingInvite ? `/join/${pendingInvite}` : '/clubs';
  return '/welcome';
}

export default function Index() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  // undefined: not checked yet. null: checked, nothing parked.
  const [pendingInvite, setPendingInvite] = useState<string | null | undefined>(
    undefined,
  );

  // AsyncStorage.getItem is async, so a signed-in member's redirect target
  // can't be decided synchronously the way the signed-out case can. Only
  // checked once signed in — a signed-out member never has anything to
  // redeem yet.
  //
  // The `if (loading) return` is load-bearing, and its absence was a real
  // bug. On the very first render `useSession` reports `{ loading: true,
  // session: null }`, so without it the `!session` branch fired immediately
  // and set `pendingInvite` to `null`. By the time the session resolved the
  // value was `null` rather than the `undefined` sentinel, so
  // `resolveIndexRedirect` considered the question answered and sent the
  // member to `/clubs` before the storage read could even start — the
  // sentinel never got its chance and the parked token stayed in AsyncStorage
  // forever, unredeemed and never cleared.
  //
  // The happy path hid it: `/sign-in` and `/auth/callback` redirect to `/`
  // *after* a session exists, so Index mounts with `loading` already false.
  // It only broke on cold launch — park a token while signed out, close the
  // app, come back through the emailed magic link.
  //
  // Depends on `session?.user.id`, not `session`: supabase-js hands out a new
  // session object on every token refresh, and re-running this on a refresh
  // would restart the storage read for no reason.
  useEffect(() => {
    if (loading) return;
    if (!userId) {
      setPendingInvite(null);
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(PENDING_INVITE_KEY)
      .then((value) => {
        if (!cancelled) setPendingInvite(value);
      })
      .catch((cause) => {
        console.error('Failed to read pending invite', cause);
        if (!cancelled) setPendingInvite(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, userId]);

  const redirect = resolveIndexRedirect(loading, !!session, pendingInvite);

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
