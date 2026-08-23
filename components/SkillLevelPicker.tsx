import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';
import { SkillDotsIcon } from './icons';
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
 * The design's skill-level picker: three tall tile-like buttons with
 * mahjong-tile dot glyphs (one/two/three dots for
 * beginner/intermediate/advanced), wrapped in an accessibilityRole
 * "radiogroup" so screen readers announce one grouped choice rather than
 * three unrelated radios.
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
            <View style={styles.iconWell}>
              <SkillDotsIcon level={level.value} />
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
  iconWell: {
    width: 34,
    height: 46,
    borderRadius: 11,
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
