import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Screen from '../components/Screen';
import TabBar from '../components/TabBar';
import { useSession } from '../lib/session';
import { colors, space, type } from '../lib/theme';

/**
 * A placeholder, and honest about it. The design's messages, thread and
 * compose screens describe club threads with replies; none of that exists
 * yet. The screen is here so the tab bar has four real destinations rather
 * than three and a dead one.
 *
 * The club broadcasts this app already has are a different feature — one-way,
 * organizer to club, no thread — and are reached from the club screen.
 */
export default function MessagesScreen() {
  const { session, loading } = useSession();

  // A themed loading screen carrying the tab bar, not a bare `null`. Every
  // other tab screen keeps the bar up in all of its states (see
  // app/clubs/index.tsx): TabBar navigates with `router.replace` off an entry
  // route that is itself a `<Redirect>`, so the history stack is typically one
  // deep and a blank frame here is a screen with nothing on it and no way off.
  //
  // The `<Redirect>` below is the deliberate exception: it renders nothing and
  // a signed-out member belongs at sign-in, not in a tab bar.
  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="messages" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen contentStyle={styles.container} tabBar={<TabBar active="messages" />}>
      <View style={styles.body}>
        <Text style={styles.heading}>Messages</Text>
        <Text style={styles.help}>
          Club messages are on the way. For now, organizers can reach everyone
          from their club&apos;s page.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    // Every other screen supplies its own side margins here — Screen itself
    // has no default padding — and this one supplied only a gap, so the
    // heading and body sat flush against the viewport edge.
    padding: space[6],
    gap: space[4],
  },
  centered: {
    alignItems: 'center',
  },
  body: {
    gap: space[3],
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
});
