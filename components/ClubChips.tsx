import { Pressable, StyleSheet, Text, View } from 'react-native';
import UnreadBadge from './UnreadBadge';
import type { Chip } from '../lib/dashboard';
import { unreadSuffix } from '../lib/messages';
import { colors, radius, space, type } from '../lib/theme';

/**
 * The artboard's club switcher. Selection is presentation state the
 * dashboard owns; this component only reports presses.
 *
 * Not built from Button: the artboard's chip carries a leading dot only when
 * active and uses the body face rather than Button's heading face, and
 * bending Button that far is more code than the row it replaces.
 *
 * Wraps onto as many lines as it needs rather than scrolling horizontally:
 * selecting a chip is now the only way to arm the header's Manage control,
 * so a chip clipped or scrolled off-screen would hide a member's only route
 * into that club. Wrapping means nothing is ever hidden, at any club count.
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
    <View style={styles.row}>
      {chips.map((chip) => {
        const active = chip.id === selected;
        const count = unreadByClub?.[chip.id] ?? 0;
        return (
          <Pressable
            key={chip.id}
            onPress={() => onSelect(chip.id)}
            accessibilityRole="button"
            // The count is composed in here rather than left on
            // UnreadBadge's own <Text>: react-native-web's aria-label
            // REPLACES the accessible name computed from a Pressable's
            // children, it does not merge with it, so the badge nested
            // below would otherwise never reach assistive tech.
            accessibilityLabel={`${chip.label}${unreadSuffix(count)}`}
            aria-selected={active}
            style={styles.chip}
          >
            {active ? <View style={styles.dot} /> : null}
            <Text style={styles.label}>{chip.label}</Text>
            <UnreadBadge count={count} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
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
