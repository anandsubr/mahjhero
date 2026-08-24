import { StyleSheet, View } from 'react-native';
import type { SkillTier } from '../lib/bookings';
import { colors, space } from '../lib/theme';

const FILLED_COUNT: Record<'beginner' | 'intermediate' | 'advanced', number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};

type Props = {
  tier: SkillTier;
  /**
   * Pip/dash colour. Defaults to the muted display colour (this component's
   * most common home, next to TableCard's tier text on a card background).
   * TierPicker overrides this per option/selection state, since a selected
   * pill's background is `colors.accentColor` and a pip drawn in that same
   * colour would be invisible against it.
   */
  color?: string;
};

/**
 * The compact visual for a table's skill tier: three pips filled
 * left-to-right for beginner (1) / intermediate (2) / advanced (3), and a
 * short dash -- NOT zero pips -- for mixed/any level. Zero pips would read
 * as "no tier set"; a dash reads as "all levels welcome", which is what
 * `mixed` actually means.
 *
 * Purely decorative (`aria-hidden`): this never carries the tier's meaning
 * on its own, for two reasons the human was explicit about -- this app's
 * design system holds an 18pt floor for anything meant to be read, which a
 * 10px pip cannot satisfy, and a screen reader has nothing to announce from
 * a row of plain Views. Every place this renders sits beside text that
 * spells the tier out in words: TierPicker's current-tier word for the
 * host's control, and TableCard's own tier text for the member-facing
 * display.
 *
 * `testID`s (`pip-filled` / `pip-outline` / `pip-dash`) exist purely so
 * components/__tests__/SkillTierPips.test.tsx can count them --
 * react-native-web renders `testID` as `data-testid`
 * (node_modules/react-native-web/dist/modules/createDOMProps/index.js).
 */
export default function SkillTierPips({ tier, color = colors.textMuted }: Props) {
  if (tier === 'mixed') {
    return (
      <View style={styles.row} aria-hidden>
        <View testID="pip-dash" style={[styles.dash, { backgroundColor: color }]} />
      </View>
    );
  }

  const filled = FILLED_COUNT[tier];

  return (
    <View style={styles.row} aria-hidden>
      {[0, 1, 2].map((index) => {
        const isFilled = index < filled;
        return (
          <View
            key={index}
            testID={isFilled ? 'pip-filled' : 'pip-outline'}
            style={[
              styles.pip,
              { borderColor: color },
              isFilled ? { backgroundColor: color } : styles.pipOutline,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
  },
  pip: {
    width: 10,
    height: 10,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  pipOutline: {
    backgroundColor: 'transparent',
  },
  dash: {
    width: 14,
    height: 3,
    borderRadius: 999,
  },
});
