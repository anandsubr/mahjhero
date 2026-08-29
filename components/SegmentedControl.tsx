import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

export type Segment = { key: string; label: string };

/**
 * The design system's pill-shaped segmented control.
 *
 * Pressing the already-selected segment is a deliberate no-op — the same
 * question components/TabBar.tsx answers for a tab already on its own route.
 * Re-reporting it would re-sort the list under the member's thumb for no
 * change.
 */
export default function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: Segment[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View style={styles.track}>
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => {
              if (selected) return;
              onChange(option.key);
            }}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            aria-selected={selected}
            style={[styles.segment, selected ? styles.segmentOn : null]}
          >
            <Text style={[styles.label, selected ? styles.labelOn : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: space[1],
    gap: space[1],
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: radius.pill,
  },
  segmentOn: { backgroundColor: colors.bg },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    // neutral[700] rather than textMuted: this sits on `surface`, where the
    // same contrast reasoning TabBar records applies.
    color: colors.neutral[700],
  },
  labelOn: { color: colors.accent[700] },
});
