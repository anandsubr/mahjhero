import { StyleSheet, Text } from 'react-native';
import Screen from '../../../../../components/Screen';
import { colors, space, type } from '../../../../../lib/theme';

/**
 * Placeholder. Task 12's Upcoming list links each event card here so nothing
 * 404s on web while this route does not exist yet. Task 14 replaces this
 * with the real read-only event view, per the plan in
 * docs/superpowers/plans/2026-08-22-events-and-scheduling.md (which also
 * notes the `[eventId]/index.tsx` + `[eventId]/edit.tsx` file layout, since
 * expo-router cannot have both a file and a directory of the same name).
 */
export default function EventDetailScreen() {
  return (
    <Screen contentStyle={styles.container}>
      <Text style={styles.heading}>Game details</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space[6],
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
});
