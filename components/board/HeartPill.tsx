import { Pressable, StyleSheet } from 'react-native';
import { Text } from '../Text';
import { HeartIcon } from '../icons';
import { colors, type } from '../../lib/theme';

type Props = {
  count: number;
  hearted: boolean;
  /** A toggle is in flight: the pill ignores presses. */
  busy: boolean;
  onPress: () => void;
};

/** Heart control for a Board post: icon + count in a 44pt-tall pill. */
export default function HeartPill({ count, hearted, busy, onPress }: Props) {
  const tint = hearted ? colors.accent[700] : colors.neutral[700];
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={hearted ? 'Remove your heart' : 'Heart this post'}
      accessibilityState={{ disabled: busy, busy, selected: hearted }}
      style={[styles.pill, hearted ? styles.pillOn : null]}
    >
      <HeartIcon size={20} color={tint} filled={hearted} />
      <Text style={[styles.count, { color: tint }]}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.surface,
  },
  pillOn: { backgroundColor: colors.accent[200] },
  count: { fontFamily: type.bodyBold, fontSize: 16 },
});
