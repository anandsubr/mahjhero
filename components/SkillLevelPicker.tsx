import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';
import SkillLevelPips from './SkillLevelPips';
import type { SkillLevel } from '../lib/profile';

const LEVELS: { value: SkillLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

type SkillLevelPickerProps = {
  value: SkillLevel | null;
  onChange: (level: SkillLevel) => void;
};

/**
 * The design's skill-level picker: three tall tile-like buttons with the
 * app-wide skill pip glyph (SkillLevelPips -- one/two/three filled pips for
 * beginner/intermediate/advanced, the same glyph TableCard uses for a
 * table's tier), wrapped in an accessibilityRole "radiogroup" so screen
 * readers announce one grouped choice rather than three unrelated radios.
 *
 * This used to draw its own vertically-stacked outlined-dot glyph
 * (`SkillDotsIcon`, since removed) where the DOT COUNT alone carried the
 * level -- one dot for Beginner, two for Intermediate, three for Advanced --
 * so there was no way to see from the glyph itself how many levels exist,
 * unlike the pips everywhere else, which always show three slots with N
 * filled. `pipWell` below is reshaped from that glyph's old box (34x46,
 * tall and narrow, sized for a vertical dot stack) to a wide-short box that
 * fits SkillTierPips's horizontal three-pip row instead -- three 10px pips
 * plus two 4.4px gaps come to ~39px wide by 10px tall, so a tall narrow well
 * would have squeezed it. The well's height stays fixed across all three
 * tiles because the row is always three pips wide regardless of level
 * (filled vs. outlined differs, not the count of pips), so the glyph never
 * shifts the tile's layout between options.
 *
 * Never passed `'mixed'`: `SkillLevelPips` takes `SkillLevel`, which cannot
 * express it (see that component's own docstring) -- a person is never
 * "any level", only a table can be.
 */
export default function SkillLevelPicker({ value, onChange }: SkillLevelPickerProps) {
  return (
    <View accessibilityRole="radiogroup" style={styles.group}>
      {LEVELS.map((level) => {
        const selected = value === level.value;
        return (
          <Pressable
            key={level.value}
            onPress={() => onChange(level.value)}
            accessibilityRole="radio"
            // Flat `aria-selected`, not `accessibilityState={{ selected }}`
            // (which this used to send) -- react-native-web's createDOMProps
            // has no handling for `accessibilityState` at all, so every tile
            // rendered `role="radio"` with no state a screen reader could
            // read. See components/Toggle.tsx's docstring for the full
            // account; React Native's own Pressable resolves `selected:
            // ariaSelected ?? accessibilityState?.selected`, so this one prop
            // still reaches the native accessibility tree too.
            aria-selected={selected}
            accessibilityLabel={level.label}
            style={[styles.tile, selected ? styles.tileSelected : null]}
          >
            <View style={styles.pipWell}>
              <SkillLevelPips level={level.value} color={colors.accentColor} />
            </View>
            <Text style={styles.label}>{level.label}</Text>
            <View style={[styles.indicator, selected ? styles.indicatorOn : null]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    gap: space[2],
  },
  tile: {
    flex: 1,
    height: 108,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[1],
    gap: space[2],
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tileSelected: {
    borderColor: colors.accentColor,
    backgroundColor: colors.accent[100],
  },
  pipWell: {
    // Wide-short, not tall-narrow: sized for SkillTierPips's horizontal
    // three-pip row (~39px wide, 10px tall — see this file's top docstring)
    // rather than the vertical dot stack this glyph used to be.
    width: 52,
    height: 32,
    borderRadius: 12,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.text,
    textAlign: 'center',
  },
  indicator: {
    height: 4,
    width: 26,
    borderRadius: radius.pill,
    backgroundColor: 'transparent',
  },
  indicatorOn: {
    backgroundColor: colors.accentColor,
  },
});
