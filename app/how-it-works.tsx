import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Button from '../components/Button';
import Card from '../components/Card';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import { ChevronLeftIcon } from '../components/icons';
import { GENERIC_ERROR } from '../lib/constants';
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
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="profile" />}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push('/profile')}
        accessibilityLabel="Back to your profile"
        style={styles.back}
      >
        Profile
      </Button>

      <Text style={styles.heading}>How it works</Text>

      <Card style={styles.card}>
        <Text style={styles.section}>Playing</Text>
        <Text style={styles.body}>1. Find a game on your dashboard.</Text>
        <Text style={styles.body}>2. Tap Join to take a spot, or Invite to bring someone along.</Text>
        <Text style={styles.body}>3. Game full? Tap Join the waitlist and you'll move up if a seat opens.</Text>
        <Text style={styles.body}>4. On the day, check the game page for your table and messages.</Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Organizing</Text>
        <Text style={styles.body}>1. Create your club.</Text>
        <Text style={styles.body}>2. Schedule your first game. Choose Assigned tables or Open seating, and set Cost to play.</Text>
        <Text style={styles.body}>3. Invite your players by email, or import a roster.</Text>
        <Text style={styles.body}>4. Say hello with an announcement in the club thread.</Text>
        <Text style={styles.body}>On the night, open the game's Door list to mark who's Here and who has paid.</Text>
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
  back: { alignSelf: 'flex-start' },
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
