import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import Screen from '../components/Screen';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';
import { PENDING_INVITE_KEY } from './join/[token]';

export default function Index() {
  const { session, loading } = useSession();
  // undefined: not checked yet. null: checked, nothing parked.
  const [pendingInvite, setPendingInvite] = useState<string | null | undefined>(
    undefined,
  );

  // AsyncStorage.getItem is async (unlike the `localStorage` the brief for
  // this route assumed), so a signed-in member's redirect target can't be
  // decided synchronously the way the signed-out case can. Only checked once
  // signed in — a signed-out member never has anything to redeem yet.
  useEffect(() => {
    if (!session) {
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
  }, [session]);

  if (loading || (session && pendingInvite === undefined)) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (session) {
    return <Redirect href={pendingInvite ? `/join/${pendingInvite}` : '/clubs'} />;
  }
  return <Redirect href="/sign-in" />;
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
  },
});
