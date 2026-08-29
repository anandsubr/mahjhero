import { StyleSheet, Text } from 'react-native';
import { unreadLabel } from '../lib/messages';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's accent pill.
 *
 * Renders nothing at zero rather than an empty pill: ordinary messages never
 * email, so this badge is the ONLY signal a member gets, and a badge that is
 * always present says nothing when it matters.
 *
 * `colors.bg` on `accentColor` measures well above AA at this weight; this
 * is the artboard's own pairing and the one place accentColor is used as a
 * background for text.
 */
export default function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <Text style={styles.badge}>{unreadLabel(count)}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accentColor,
    color: colors.bg,
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    textAlign: 'center',
    paddingHorizontal: space[2],
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
