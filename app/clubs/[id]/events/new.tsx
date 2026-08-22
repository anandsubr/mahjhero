import { StyleSheet, Text } from 'react-native';
import Screen from '../../../../components/Screen';
import { colors, space, type } from '../../../../lib/theme';

/**
 * Placeholder. Task 12 (the club screen's "Add a game" button and the
 * Upcoming list's event cards) links here so nothing 404s on web while this
 * route does not exist yet. Task 13 replaces this with the real create
 * screen — one-off or recurring, per the plan in
 * docs/superpowers/plans/2026-08-22-events-and-scheduling.md.
 */
export default function CreateEventScreen() {
  return (
    <Screen contentStyle={styles.container}>
      <Text style={styles.heading}>Add a game</Text>
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
