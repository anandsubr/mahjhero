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
 * `colors.text` instead. That got accentColor to 4.60:1, but accent2Color
 * only reached 4.45:1 — 0.05 short of AA. Rather than a dark, saturated
 * fill with dark text (which was always going to be a tight fit), the
 * selected fills now use the *300 tint* of each scale (`colors.accent[300]`
 * / `colors.accent2[300]`) instead of the single mid-tone
 * accentColor/accent2Color values: `colors.text` measures 10.97:1 on
 * accent[300] and 11.34:1 on accent2[300] — both miles clear of 4.5:1, and
 * the pastel tint suits this "Organic" palette better than a saturated
 * chip with dark text on it anyway.
 *
 * That tint is close in luminance to `colors.bg` itself, though
 * (accent[300] is only 1.27:1 against bg, accent2[300] only 1.23:1) — too
 * subtle a shift to trust as the *only* signal that a chip is selected, so
 * `choiceOn`/`choiceOff` also widen the border from 2px to 4px AND switch
 * its colour from the neutral `colors.divider` to the saturated
 * `colors.accentColor`/`colors.accent2Color` (the same mid-tones the fill
 * tints are themselves derived from, so the border reads as "more of the
 * same hue", not a clashing third colour). Width alone was a final-review
 * finding: on the one screen used standing up in a dim hall, a 2px-vs-4px
 * difference on an otherwise identical grey line is easy to miss at a
 * glance, and a fill only 1.23–1.27:1 off the page background does not
 * help. `colors.accentColor`/`accent2Color` measure 3.03:1 / 3.14:1
 * against `colors.bg` — over the 3:1 WCAG 1.4.11 floor for non-text UI
 * boundaries — and are visibly a different hue from the neutral divider
 * (1.38:1 against bg) an unselected chip carries, so colour and width now
 * both signal selection rather than width alone; see
 * components/__tests__/CheckInControl.test.tsx's docstring and the task
 * report for the full measurements.
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
  // `display_name` has no non-empty constraint and defaults to `''`
  // (lib/clubs.ts / event_attendance) -- an unnamed member's row used to
  // render "Here: " with a trailing space, silently announcing nothing to
  // a screen reader. Trimmed, not just falsy-checked: a name that is pure
  // whitespace is exactly as unhelpful as an empty string.
  const safeLabel = label.trim() ? label : 'this person';

  function press(choice: AttendanceState) {
    if (isDisabled) return;
    onChange(state === choice ? null : choice);
  }

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Here: ${safeLabel}`}
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
        accessibilityLabel={`Not coming: ${safeLabel}`}
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
  // Pastel tints for the FILL, not `accentColor`/`accent2Color` — see the
  // contrast measurements in this file's docstring. `borderWidth` jumps
  // from the base 2px to 4px AND `borderColor` switches from the neutral
  // `colors.divider` to the saturated mid-tone, so a selected chip is
  // never signalled by width alone.
  choiceOn: {
    backgroundColor: colors.accent2[300],
    borderWidth: 4,
    borderColor: colors.accent2Color,
  },
  choiceOff: {
    backgroundColor: colors.accent[300],
    borderWidth: 4,
    borderColor: colors.accentColor,
  },
  dim: { opacity: 0.4 },
  // `colors.text`, not `colors.bg` — see the contrast measurements in this
  // file's docstring. Both fills use the same label colour, and both clear
  // 4.5:1 with a wide margin.
  text: { fontFamily: type.bodyRegular, fontSize: type.size.body, color: colors.text },
});
