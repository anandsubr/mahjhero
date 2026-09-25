import { Pressable, StyleSheet, View } from 'react-native';
import { CheckIcon, XIcon } from './icons';
import type { AttendanceState } from '../lib/attendance';
import { colors, radius } from '../lib/theme';

type Props = {
  /** Null means not determined — nobody has said anything about this person. */
  state: AttendanceState | null;
  /** `null` clears the record. */
  onChange: (next: AttendanceState | null) => void;
  disabled?: boolean;
  busy?: boolean;
  /** The person this control is about. Names them for a screen reader. */
  label: string;
};

/**
 * The door list's Here / Not coming pair (check-in redesign 1a): two 40pt
 * icon circles in one pill. Same contract as CheckInControl — tapping the
 * active choice clears it, the same labels and `aria-pressed` — so the door
 * list keeps every behaviour it had. CheckInControl itself is unchanged; the
 * game screen and dashboard still use it.
 */
export default function DoorStatusControl({
  state,
  onChange,
  disabled = false,
  busy = false,
  label,
}: Props) {
  const isDisabled = disabled || busy;
  const safeLabel = label.trim() ? label : 'this person';
  const here = state === 'arrived';
  const no = state === 'no_show';

  function press(choice: AttendanceState) {
    if (isDisabled) return;
    onChange(state === choice ? null : choice);
  }

  return (
    <View style={[styles.pill, isDisabled && styles.dim]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Here: ${safeLabel}`}
        aria-pressed={here}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={busy}
        onPress={() => press('arrived')}
        style={[styles.choice, here && styles.hereOn]}
      >
        <CheckIcon size={18} color={here ? '#ffffff' : colors.neutral[600]} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Not coming: ${safeLabel}`}
        aria-pressed={no}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={busy}
        onPress={() => press('no_show')}
        style={[styles.choice, no && styles.noOn]}
      >
        <XIcon size={17} color={no ? '#ffffff' : colors.neutral[600]} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    flexShrink: 0,
  },
  choice: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hereOn: { backgroundColor: colors.accent2[600] },
  noOn: { backgroundColor: colors.neutral[700] },
  dim: { opacity: 0.4 },
});
