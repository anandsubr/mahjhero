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
 * `accent[700]`, not the artboard's `accentColor`: `colors.bg` on
 * `accentColor` measures 3.03:1, and this text is 16px bold — below the
 * 14pt-bold "large text" threshold — so it needs AA's 4.5:1, not 3:1. It
 * fails. accent[700] reads 5.72:1 against `colors.bg` and clears AA. Same
 * failure, and the same fix, as components/TabBar.tsx's selected-tab tint.
 */
export default function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <Text style={styles.badge}>{unreadLabel(count)}</Text>;
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    color: colors.bg,
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    textAlign: 'center',
    paddingHorizontal: space[2],
    paddingVertical: 1,
    overflow: 'hidden',
  },
});
