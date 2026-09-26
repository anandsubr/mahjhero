import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, radius, space, type } from '../lib/theme';

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
 * Task 8's original brief called for the sage `accent2` fill "so it reads as
 * distinct from the terracotta Here action" — but in `CheckInControl`, "Here"
 * IS the sage chip (`choiceOn` = `accent2[300]`; terracotta `accent[300]` is
 * "Not coming"). Sage-on-sage put this control's paid state inches from
 * Here in the same row, in the same hue and the same pill shape — exactly
 * the collision the brief thought it was avoiding, and a host scanning a
 * 60-70 name door list at a glance would misread one for the other.
 *
 * The check-in redesign (1a) settled the form: a 40pt circular `$` badge,
 * a dashed `neutral[400]` ring when unpaid and a pale sage `accent2[200]`
 * fill when paid. It no longer collides with Here, which is now a solid
 * `accent2[600]` icon circle inside DoorStatusControl's pill — different
 * shape, different weight, and a glyph rather than a tick.
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
        style={[styles.badge, paid && styles.badgeOn, isDisabled && styles.dim]}
      >
        <Text style={[styles.glyph, paid && styles.glyphOn]}>$</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[2] },
  badge: {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOn: {
    borderStyle: 'solid',
    borderColor: colors.accent2[200],
    backgroundColor: colors.accent2[200],
  },
  dim: { opacity: 0.4 },
  glyph: {
    fontFamily: type.bodyBold,
    fontSize: 16,
    color: colors.neutral[600],
  },
  glyphOn: { color: colors.accent2[800] },
});
