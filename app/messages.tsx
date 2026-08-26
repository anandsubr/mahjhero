import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
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

  if (loading) return null;
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
    gap: space[4],
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
