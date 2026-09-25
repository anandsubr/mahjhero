import { Pressable, StyleSheet, Text } from 'react-native';
import { ChevronLeftIcon } from './icons';
import { colors, radius, type } from '../lib/theme';

/**
 * The redesigned sub-screens' "‹ Profile" back row (notifications/friends
 * handoff): a 44pt ghost pill, 22px chevron, bold 16 label in `text`.
 */
export default function BackRow({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.row,
        (pressed || hovered) && styles.active,
      ]}
    >
      <ChevronLeftIcon size={22} color={colors.text} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 44,
    paddingLeft: 6,
    paddingRight: 12,
    marginLeft: -6,
    borderRadius: radius.pill,
  },
  active: { backgroundColor: colors.surface },
  label: { fontFamily: type.bodyBold, fontSize: 16, color: colors.text },
});
