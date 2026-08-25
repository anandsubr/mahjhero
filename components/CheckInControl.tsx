import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AttendanceState } from '../lib/attendance';
import { colors, space, type } from '../lib/theme';

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
 * Two buttons, three states.
 *
 * Pressing the choice that is already active CLEARS it rather than doing
 * nothing — that is the undo, and it is the only way back to "not
 * determined". A separate third button for "clear" was considered and
 * rejected: at the door the host is tapping fast, and a mis-tap has to be
 * fixable by tapping the same place again.
 *
 * `aria-pressed`, not `accessibilityState={{ selected }}`: react-native-web
 * does not forward `accessibilityState` to the DOM at all, so a screen
 * reader would announce two identical unlabelled buttons. Toggle.tsx carries
 * the full write-up of that trap; `aria-disabled`/`aria-busy` below follow
 * the same flat-prop pattern Button.tsx uses for the identical reason.
 *
 * Both fills' label colour was measured against `lib/theme.ts`'s WCAG
 * relative-luminance formula: `colors.bg` on `colors.accentColor` is
 * 3.03:1 and on `colors.accent2Color` is 3.14:1 — both well under the 4.5:1
 * AA floor for this (non-"large") text size, so both labels use
 * `colors.text` instead (4.60:1 on accentColor, 4.45:1 on accent2Color —
 * see components/__tests__/CheckInControl.test.tsx's docstring and the
 * task report for the residual concern on the accent2Color pairing).
 *
 * Used by all three surfaces — the door list, the event screen, and Your
 * games — so a host and a member cannot end up with controls that behave
 * differently.
 */
export default function CheckInControl({
  state,
  onChange,
  disabled = false,
  busy = false,
  label,
}: Props) {
  const isDisabled = disabled || busy;

  function press(choice: AttendanceState) {
    if (isDisabled) return;
    onChange(state === choice ? null : choice);
  }

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Here: ${label}`}
        aria-pressed={state === 'arrived'}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={busy}
        onPress={() => press('arrived')}
        style={[
          styles.choice,
          state === 'arrived' && styles.choiceOn,
          isDisabled && styles.dim,
        ]}
      >
        <Text style={styles.text}>Here</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Not coming: ${label}`}
        aria-pressed={state === 'no_show'}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={busy}
        onPress={() => press('no_show')}
        style={[
          styles.choice,
          state === 'no_show' && styles.choiceOff,
          isDisabled && styles.dim,
        ]}
      >
        <Text style={styles.text}>Not coming</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[2] },
  choice: {
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.divider,
  },
  choiceOn: { backgroundColor: colors.accent2Color },
  choiceOff: { backgroundColor: colors.accentColor },
  dim: { opacity: 0.4 },
  // `colors.text`, not `colors.bg` — see the contrast measurements in this
  // file's docstring. Both fills use the same label colour: it is the one
  // that clears (or comes closest to clearing) 4.5:1 on both.
  text: { fontFamily: type.bodyRegular, fontSize: type.size.body, color: colors.text },
});
