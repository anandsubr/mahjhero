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
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !token) return;

    if (!session) {
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
    acceptInvite(token).then(({ clubId, error: acceptError }) => {
      if (cancelled) return;
      AsyncStorage.removeItem(PENDING_INVITE_KEY).catch((cause) => {
        console.error('Failed to clear pending invite', cause);
      });
      if (acceptError || !clubId) {
        setError(acceptError ?? 'That invite link is no longer valid.');
        return;
      }
      router.replace(`/clubs/${clubId}`);
    });

    return () => {
      cancelled = true;
    };
  }, [loading, session, token, router]);

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
