import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Chip } from '../lib/dashboard';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's horizontal club switcher. Selection is presentation state
 * the dashboard owns; this component only reports presses.
 *
 * Not built from Button: the artboard's chip carries a leading dot only when
 * active and uses the body face rather than Button's heading face, and
 * bending Button that far is more code than the row it replaces.
 */
export default function ClubChips({
  chips,
  selected,
  onSelect,
}: {
  chips: Chip[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chips.map((chip) => {
        const active = chip.id === selected;
        return (
          <Pressable
            key={chip.id}
            onPress={() => onSelect(chip.id)}
            accessibilityRole="button"
            accessibilityLabel={chip.label}
            aria-selected={active}
            style={styles.chip}
          >
            {active ? <View style={styles.dot} /> : null}
            <Text style={styles.label}>{chip.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[2],
    paddingBottom: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: 44,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accentColor,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
});
