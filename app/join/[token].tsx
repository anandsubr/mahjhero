import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import { PENDING_INVITE_KEY, acceptInvite } from '../../lib/clubs';
import { useSession } from '../../lib/session';
import { colors, space, type } from '../../lib/theme';

/**
 * Where an invite link lands.
 *
 * Most people opening one have never used MahjHero. They arrive signed out, so
 * the token is parked in storage, they sign in, and `app/index.tsx` sends them
 * back here to redeem it. Losing the invite across sign-in would mean asking
 * the host to send another. See `PENDING_INVITE_KEY` in `lib/clubs.ts` for
 * where that storage key lives and why.
 *
 * Storage is `@react-native-async-storage/async-storage`, not
 * `globalThis.localStorage`. React Native has no `localStorage` global; a
 * bare `globalThis.localStorage?.setItem(...)` would silently no-op on iOS
 * and Android (the `?.` swallows the `undefined` receiver instead of
 * throwing), parking the token nowhere. The member would sign in, land on an
 * empty clubs list, and have no idea their invite was ever lost. AsyncStorage
 * is already a dependency (see `lib/supabase.ts`) and works identically on
 * web, iOS, and Android, so it is used here unconditionally rather than
 * branching on `Platform.OS`.
 */
export default function JoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { session, loading } = useSession();
  // Not `session`: supabase-js hands out a fresh session object on every
  // token refresh, so an effect depending on the object re-runs roughly
  // hourly. Here that meant a second `acceptInvite` on an already-spent
  // token — which correctly reports "expired or already used" — replacing
  // the club screen the member had just successfully joined with an error
  // for a link that worked. The user id is what the effect actually cares
  // about and it does not change on a refresh.
  const userId = session?.user.id;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !token) return;

    if (!userId) {
      // Best-effort: even if the write fails (storage quota, corrupt native
      // storage), still send the member to sign in rather than stranding them
      // here — signing in is still useful even if this particular invite ends
      // up lost.
      AsyncStorage.setItem(PENDING_INVITE_KEY, token)
        .catch((cause) => {
          console.error('Failed to store pending invite', cause);
        })
        .finally(() => {
          router.replace('/sign-in');
        });
      return;
    }

    let cancelled = false;
    // The clear is awaited, not fired and forgotten. Navigating first left a
    // slow or failing `removeItem` racing an unmount, so a spent token could
    // stay parked in storage forever — and `app/index.tsx` would send the
    // member back here to redeem it again on every cold launch, showing an
    // "expired" screen each time. `.catch` keeps a storage failure from
    // stranding them on the spinner: the redemption itself already
    // succeeded, so the only right move is to carry on to the club.
    acceptInvite(token)
      .then(async ({ clubId, error: acceptError }) => {
        if (cancelled) return;
        await AsyncStorage.removeItem(PENDING_INVITE_KEY).catch((cause) => {
          console.error('Failed to clear pending invite', cause);
        });
        if (cancelled) return;
        if (acceptError || !clubId) {
          setError(acceptError ?? 'That invite link is no longer valid.');
          return;
        }
        router.replace(`/clubs/${clubId}`);
      });

    return () => {
      cancelled = true;
    };
  }, [loading, userId, token, router]);

  if (error) {
    return (
      <Screen contentStyle={styles.container}>
        <Text style={styles.heading}>That link did not work</Text>
        <ErrorBanner message={error} />
        <Button
          onPress={() => router.replace('/clubs')}
          accessibilityLabel="Go to your clubs"
          >Go to your clubs</Button>
      </Screen>
    );
  }

  return (
    <Screen center contentStyle={styles.centered}>
      <View style={styles.spinnerGroup}>
        <ActivityIndicator
          color={colors.accentColor}
          accessibilityLabel="Joining the club"
        />
        <Text style={styles.message}>Joining the club…</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space[6],
    gap: space[4],
  },
  centered: {
    alignItems: 'center',
  },
  spinnerGroup: {
    alignItems: 'center',
    gap: 16,
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  message: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
});
