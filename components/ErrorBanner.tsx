import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The design's recurring inline-error treatment: an accent-tinted card with
 * a small dot and the message, used on sign-in, notifications, and (by
 * extension, for consistency) profile save failures.
 *
 * `accessibilityRole="alert"` lives HERE rather than on a wrapping View at
 * each call site. Two screens wrapped it and three did not, which meant the
 * same failure was announced to a screen reader on some screens and silently
 * painted on others -- and the wrapper is not something a call site can
 * reasonably be expected to remember, since nothing about the banner's own
 * API hinted it was missing. Every use of this component is a failure the
 * member needs told about without hunting for the text, so the role belongs
 * to the component.
 */
export default function ErrorBanner({ message }: { message: string }) {
  return (
    <View accessibilityRole="alert" style={styles.container}>
      <View style={styles.dot} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    backgroundColor: colors.accent[200],
    borderRadius: radius.card,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.accent[700],
    marginTop: 8,
  },
  text: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 24,
    color: colors.accent[800],
  },
});
