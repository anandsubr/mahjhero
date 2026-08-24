import { Pressable, StyleSheet, Text, View } from 'react-native';
import SkillTierPips from './SkillTierPips';
import type { SkillTier } from '../lib/bookings';
import { colors, radius, space, type } from '../lib/theme';

export const TIER_OPTIONS: { value: SkillTier; label: string }[] = [
  { value: 'mixed', label: 'Any level' },
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
      <Text style={styles.current}>{current.label}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // This app's content column is capped at 440px even on a desktop
    // viewport (lib/theme.ts's `layout.contentMaxWidth`), so the space
    // actually available here is ~360px on desktop -- but mobile viewports
    // narrower than 440px never hit that cap at all, so their real budget
    // is smaller still. `current` (the word) is placed FIRST in this row,
    // ahead of the pips, precisely so that when there isn't room for both
    // on one line, `flexWrap` drops the PIPS to their own line below the
    // word rather than the other way around -- the word then sits directly
    // above its own pip row, not below it where it can misread as a label
    // for whatever control follows this one (see this component's own
    // git history / .superpowers/sdd/tier-pips-and-unseat.md for the bug
    // this replaced: "Mixed" wrapping below the pips read as a caption for
    // the "Remove this table" button underneath). `pill`'s size below is
    // trimmed toward, not below, this app's 44px touch-target floor, which
    // buys back some of that budget so the common-length words ("Beginner",
    // "Advanced", "Any level") do fit beside the pips even on a narrow
    // phone; "Intermediate", the longest tier word, still wraps to its own
    // line under some viewports -- confirmed by reading the regenerated
    // screenshots, not assumed. The word is never lost either way, which is
    // the actual requirement.
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
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: space[1],
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
