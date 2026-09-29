import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { CalendarIcon, ListIcon } from '../icons';
import { colors, radius, type } from '../../lib/theme';

export type MyGamesMode = 'list' | 'calendar';

/**
 * My games' small List / Calendar pill. The pill is drawn compact (32pt
 * options on a 38pt track, per the design) but each option's Pressable is a
 * full 44pt tall: the track's fill is an absolutely positioned layer inset
 * 3pt, so the touch target is bigger than what is painted. hitSlop would do
 * this on native only; react-native-web ignores it.
 */
export default function MyGamesModeToggle({
  mode,
  onChange,
}: {
  mode: MyGamesMode;
  onChange: (next: MyGamesMode) => void;
}) {
  const iconColor = (m: MyGamesMode) => (mode === m ? colors.accent[800] : colors.neutral[700]);
  return (
    <View style={styles.track}>
      <View style={styles.trackFill} pointerEvents="none" />
      <ModeButton
        label="List"
        icon={<ListIcon size={14} color={iconColor('list')} />}
        selected={mode === 'list'}
        onPress={() => onChange('list')}
      />
      <ModeButton
        label="Calendar"
        icon={<CalendarIcon size={14} color={iconColor('calendar')} />}
        selected={mode === 'calendar'}
        onPress={() => onChange('calendar')}
      />
    </View>
  );
}

function ModeButton({
  label,
  icon,
  selected,
  onPress,
}: {
  label: string;
  icon: ReactNode;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      aria-selected={selected}
      onPress={onPress}
      style={styles.hit}
    >
      <View style={[styles.pill, selected && styles.pillSelected]}>
        {icon}
        <Text style={[styles.text, selected && styles.textSelected]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', paddingHorizontal: 3 },
  trackFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 3,
    bottom: 3,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
  },
  hit: { minHeight: 44, justifyContent: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  pillSelected: { backgroundColor: colors.bg },
  text: { fontFamily: type.bodyBold, fontSize: 12, color: colors.neutral[700] },
  textSelected: { color: colors.accent[800] },
});
