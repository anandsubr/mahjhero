import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import BackRow from '../components/BackRow';
import Button from '../components/Button';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import { GENERIC_ERROR } from '../lib/constants';
import { goBack } from '../lib/navigation';
import { useSession } from '../lib/session';
import { colors, space, type } from '../lib/theme';
import { useGuides } from '../lib/use-guides';

/**
 * The replayable half of first-run guidance: everything the dashboard cards
 * and screen tips say, in one place, plus a way to bring dismissed tips back.
 */
export default function HowItWorks() {
  const { session, loading } = useSession();
  const router = useRouter();
  const { reset } = useGuides();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && !session) return <Redirect href="/sign-in" />;

  async function onReset() {
    setBusy(true);
    setError(null);
    const ok = await reset();
    setBusy(false);
    setDone(ok);
    if (!ok) setError(GENERIC_ERROR);
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <BackRow
        label="Profile"
        onPress={() => goBack(router, '/profile')}
        accessibilityLabel="Back to Profile"
      />

      <Text style={styles.heading}>How it works</Text>

      <Card style={styles.card}>
        <Text style={styles.section}>Playing</Text>
        <Text style={styles.body}>1. Join a group with its code on Home, or accept an invite there. Games you're in show on Home under Games.</Text>
        <Text style={styles.body}>2. Tap Join to take a spot, or Invite to bring someone along.</Text>
        <Text style={styles.body}>3. Game full? Tap Join the waitlist and you'll move up if a seat opens.</Text>
        <Text style={styles.body}>4. On the day, check the game page for your table and messages.</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Hosting</Text>
        <Text style={styles.body}>1. Start your group.</Text>
        <Text style={styles.body}>2. Schedule your first game. Every table seats four, and players can save seats for friends.</Text>
        <Text style={styles.body}>3. Invite your players by email, or share your group code.</Text>
        <Text style={styles.body}>4. Say hello with an announcement in the group thread.</Text>
        <Text style={styles.body}>Bigger groups can turn on a door list under Group settings → Advanced.</Text>
      </Card>

      <View style={styles.resetGroup}>
        {error ? <ErrorBanner message={error} /> : null}
        <Button
          variant="secondary"
          block
          onPress={onReset}
          disabled={busy}
          loading={busy}
          accessibilityLabel="Show tips again"
        >
          Show tips again
        </Button>
        {done ? <Text style={styles.body}>Tips will show again.</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  card: { gap: space[2] },
  section: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 26,
    color: colors.text,
  },
  resetGroup: { gap: space[2] },
});
