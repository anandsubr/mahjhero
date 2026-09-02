import { Pressable, StyleSheet } from 'react-native';
import { PlusIcon } from './icons';
import { colors, radius } from '../lib/theme';

/**
 * The circular icon-only "+" this app uses everywhere something new gets
 * created — starting a club (components/DashboardHeader.tsx), a new
 * message (app/messages/index.tsx), adding a game
 * (app/clubs/[id]/index.tsx). One component rather than three copies of the
 * same 50x50-outlined-circle-plus-PlusIcon style block.
 */
export default function PlusButton({
  onPress,
  accessibilityLabel,
}: {
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={styles.button}
    >
      <PlusIcon size={24} color={colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Outlined rather than filled, textMuted for the boundary — #676158 on
  // the page background measures 5.15:1 (lib/theme.ts records the ratio),
  // past the 3:1 a control boundary needs. Carried over unchanged from
  // DashboardHeader's own former `newClub` style.
  button: {
    width: 50,
    height: 50,
    flexShrink: 0,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.textMuted,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
