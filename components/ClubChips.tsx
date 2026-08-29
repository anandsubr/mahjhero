import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import UnreadBadge from './UnreadBadge';
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
  unreadByClub,
}: {
  chips: Chip[];
  selected: string;
  onSelect: (id: string) => void;
  unreadByClub?: Record<string, number>;
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
            <UnreadBadge count={unreadByClub?.[chip.id] ?? 0} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * The artboard's chip row is `overflow-x: auto` with `padding-bottom: 2px`,
 * a literal 2 rather than a step on the spacing scale — whose smallest step,
 * space[1], is 4.4. Named here so the number is not a mystery, and NOT added
 * to lib/theme.ts: a value with one call site is a literal, not a token.
 */
const SCROLL_GUTTER = 2;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: space[2],
    paddingBottom: SCROLL_GUTTER,
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
