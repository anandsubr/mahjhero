import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, type } from '../lib/theme';

/**
 * The artboard's little calendar chip at the head of each game row.
 *
 * Hidden from assistive tech on purpose: the row's meta line already carries
 * the full formatted date from `formatEventWhen`, so reading this out would
 * announce the same day twice. Same reasoning as SkillLevelPips, which is
 * aria-hidden beside the word it decorates.
 *
 * The design draws the tile's lip with `inset 0 -4px 0`. React Native has no
 * inset box-shadow, so it is a bottom border instead — visually the same
 * thing at this size.
 */
export default function DateTile({
  startsAt,
  timezone,
}: {
  startsAt: string;
  timezone: string;
}) {
  const when = new Date(startsAt);
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    timeZone: timezone,
  })
    .format(when)
    .toUpperCase();
  const date = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    timeZone: timezone,
  }).format(when);

  return (
    <View
      style={styles.tile}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={styles.day}>{day}</Text>
      <Text style={styles.date}>{date}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 52,
    height: 70,
    flexShrink: 0,
    borderRadius: radius.sm * 1.6,
    backgroundColor: colors.bg,
    borderBottomWidth: 4,
    borderBottomColor: colors.neutral[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  date: {
    fontFamily: type.heading,
    fontSize: 24,
    lineHeight: 26,
    color: colors.text,
  },
});
