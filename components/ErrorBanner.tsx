import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The design's recurring inline-error treatment: an accent-tinted card with
 * a small dot and the message, used on sign-in, notifications, and (by
 * extension, for consistency) profile save failures.
 */
export default function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.container}>
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
