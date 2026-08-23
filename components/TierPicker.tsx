import { Pressable, StyleSheet, Text, View } from 'react-native';
import SkillTierPips from './SkillTierPips';
import type { SkillTier } from '../lib/bookings';
import { colors, radius, space, type } from '../lib/theme';

export const TIER_OPTIONS: { value: SkillTier; label: string }[] = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

type Props = {
  /** Used only to build each option's accessibilityLabel ("Table 1: Beginner"). */
  tableLabel: string;
  tier: SkillTier;
  disabled?: boolean;
  onChange: (tier: SkillTier) => void;
};

/**
 * The host's per-table tier control: four pip-glyph options in a single row,
 * plus the CURRENT tier's word beside them.
 *
 * This replaces four full-width text chips (Mixed / Beginner / Intermediate
 * / Advanced, one per row because "Intermediate" is long) that were the
 * single biggest contributor to how tall the organizer's event screen had
 * grown -- 4 rows x every table. The human's design, from a rendered
 * screenshot: three pips filled left-to-right for beginner/intermediate/
 * advanced, a dash (not zero pips) for mixed, all four options inline.
 *
 * Two things this must not lose, both explicit in the design decision:
 *
 * 1. An icon alone cannot carry this meaning -- not for a player base this
 *    design system holds to an 18pt minimum, and not for a screen reader.
 *    The pips buy compactness for the three options you are NOT on; the one
 *    you ARE on is still spelled out in words, in `current.label` below.
 *    (`SkillTierPips` itself is `aria-hidden` for exactly this reason --
 *    see its own docstring.)
 * 2. Every option keeps a full word `accessibilityLabel`, identical in
 *    shape to the text chips this replaces (`${tableLabel}: ${label}`), so
 *    this is a strict visual compaction, not an information loss. State
 *    goes through the flat `aria-selected`/`aria-disabled` props, never
 *    `accessibilityState` -- react-native-web's `createDOMProps` has no
 *    handling for `accessibilityState` at all (see Toggle.tsx's docstring
 *    for the full account, and app/clubs/[id]/events/[eventId]/index.tsx's
 *    now-removed `TierChip`, which already got this right and is the
 *    pattern this follows).
 *
 * components/__tests__/TierPicker.test.tsx asserts the rendered
 * `aria-selected` attribute directly, not just click behaviour.
 */
export default function TierPicker({
  tableLabel,
  tier,
  disabled = false,
  onChange,
}: Props) {
  const current = TIER_OPTIONS.find((option) => option.value === tier) ?? TIER_OPTIONS[0];

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {TIER_OPTIONS.map((option) => {
          const selected = option.value === tier;
          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`${tableLabel}: ${option.label}`}
              aria-selected={selected}
              aria-disabled={disabled}
              style={[
                styles.pill,
                selected ? styles.selected : styles.unselected,
                disabled ? styles.disabled : null,
              ]}
            >
              <SkillTierPips tier={option.value} color={selected ? colors.bg : colors.text} />
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.current}>{current.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // This app's content column is capped at 440px even on a desktop
    // viewport (lib/theme.ts's `layout.contentMaxWidth`), so the space
    // actually available here is ~360px regardless of window width --
    // confirmed empirically with a debug Playwright page.evaluate(), not
    // assumed. `pill`'s padding below is trimmed to the minimum that still
    // clears this app's 46px touch-target floor, which turned out to be
    // enough for all four pips PLUS "Intermediate" (the longest tier word)
    // to sit on one line inside that budget, at every supported width --
    // also re-verified the same way, after the first attempt at this
    // (`alignSelf: 'stretch'` on this container, since removed) measured as
    // a genuine no-op: the row was never being shrunk by its container: it
    // was consistently ~12px too wide for the word at the old padding, on
    // EVERY viewport, because the 440px cap makes every viewport the same
    // effective width. `flexWrap: 'wrap'` stays as a real fallback for
    // anything narrower than this app's own minimum supported width -- the
    // word is never lost, which is the actual requirement.
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[2],
    marginTop: space[3],
  },
  row: {
    flexDirection: 'row',
    gap: space[2],
  },
  pill: {
    borderRadius: radius.pill,
    minHeight: 46,
    minWidth: 46,
    paddingHorizontal: space[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  selected: {
    backgroundColor: colors.accentColor,
    borderColor: 'transparent',
  },
  unselected: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
  },
  disabled: {
    opacity: 0.45,
  },
  current: {
    fontFamily: type.heading,
    fontSize: type.size.body,
    color: colors.text,
  },
});
