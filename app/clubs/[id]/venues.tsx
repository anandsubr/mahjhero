import { StyleSheet, Text } from 'react-native';
import Screen from '../../../components/Screen';
import { colors, space, type } from '../../../lib/theme';

/**
 * Placeholder. Task 12's club screen links here from "Venues" (organizers
 * only) so nothing 404s on web while this route does not exist yet — the
 * brief for Task 12 named this link but the file it points at is not built
 * until Task 16 (`app/clubs/[id]/venues.tsx`, per the plan in
 * docs/superpowers/plans/2026-08-22-events-and-scheduling.md), a gap the
 * brief itself did not flag the way it flagged the two events routes. Task
 * 16 replaces this with the real venue management screen.
 */
export default function ClubVenuesScreen() {
  return (
    <Screen contentStyle={styles.container}>
      <Text style={styles.heading}>Venues</Text>
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
