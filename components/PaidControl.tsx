import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space, type } from '../lib/theme';

type Props = {
  /** Whether this person has been marked paid for this event. */
  paid: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  /** The person this control is about. Names them for a screen reader. */
  label: string;
};

/**
 * The door list's payment marker: one chip, two states.
 *
 * Deliberately the same shape as `CheckInControl` — a `Pressable` carrying
 * `aria-pressed`/`aria-disabled`/`aria-busy` as flat props, `isDisabled =
 * disabled || busy`, and a `safeLabel` fallback for a nameless member — so
 * the two controls a host taps in sequence at the door behave identically
 * under the finger and announce identically to a screen reader. See
 * CheckInControl's docstring for why `aria-pressed` rather than
 * `accessibilityState` (react-native-web forwards neither `accessibilityState`
 * nor `accessibilityBusy` to the DOM) and for the contrast measurements the
 * selected fill below is taken from.
 *
 * Tapping a chip that is already on turns it OFF: marking somebody paid by
 * mistake has to be fixable by tapping the same place again, the same rule
 * CheckInControl follows for a mis-tapped arrival. `set_payment_status`
 * (20260906150000) accepts that unmark deliberately — it deletes the row
 * rather than storing a false, and skips the roster check on the way out
 * precisely so a correction can never be refused.
 *
 * The paid fill uses the sage `accent2` scale, per Task 8's brief. Note that
 * this is the SAME family CheckInControl's "Here" chip uses (its `choiceOn`
 * is `accent2[300]`; the terracotta `accent[300]` is its "Not coming"), so
 * this reads as "another affirmative mark", not as a colour that
 * distinguishes it from Here. The two are told apart by their words, which
 * is what a host reads at a badly-lit door anyway. `colors.text` on
 * `accent2[300]` measures 11.34:1, and the 4px saturated border repeats the
 * selection signal so it is never carried by fill alone.
 *
 * NOT gated on the check-in window. `set_payment_status` has no window at
 * all (unlike `record_attendance`), on purpose: money is settled whenever
 * the organizer is standing there, including at an event that never asked
 * for check-in and long after its tail has closed. Passing `disabled` from a
 * window here would invent a refusal the database does not make.
 */
export default function PaidControl({
  paid,
  onChange,
  disabled = false,
  busy = false,
  label,
}: Props) {
  const isDisabled = disabled || busy;
  // `display_name` has no non-empty constraint and defaults to `''`
  // (lib/clubs.ts / event_attendance) — the same guard CheckInControl and
  // the door list's own `safeDisplayName` carry, for the same reason: an
  // unnamed member would otherwise announce "Paid: " and name nobody.
  const safeLabel = label.trim() ? label : 'this person';

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Paid: ${safeLabel}`}
        aria-pressed={paid}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-busy={busy}
        onPress={() => {
          if (isDisabled) return;
          onChange(!paid);
        }}
        style={[styles.choice, paid && styles.choiceOn, isDisabled && styles.dim]}
      >
        <Text style={styles.text}>Paid</Text>
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
  choiceOn: {
    backgroundColor: colors.accent2[300],
    borderWidth: 4,
    borderColor: colors.accent2Color,
  },
  dim: { opacity: 0.4 },
  text: { fontFamily: type.bodyRegular, fontSize: type.size.body, color: colors.text },
});
