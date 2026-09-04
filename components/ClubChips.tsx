import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlusIcon } from './icons';
import MahjongTile from './MahjongTile';
import UnreadBadge from './UnreadBadge';
import { glyphForClub, initialsFrom } from '../lib/dashboard';
import type { Chip } from '../lib/dashboard';
import { unreadSuffix } from '../lib/messages';
import { colors, control, space, type } from '../lib/theme';

/**
 * The artboard's club switcher, icon-over-label — the same shape
 * components/TabBar.tsx uses for every tab, but drawn with `MahjongTile`'s
 * own `size="chip"` variant (48x60), distinct from TabBar's `size="tab"`
 * (70x77). Each club gets its own `glyphForClub`-derived suit on the tile
 * face, with its initials as the tile's label underneath.
 *
 * No "All clubs" chip: it never represented a real club, and the row's own
 * visibility already carries that meaning (app/clubs/index.tsx draws it
 * exactly when nothing is filtered in). A trailing "New club" tile takes
 * its place at the end of the row — a same-sized outlined tile, not a
 * club's solid glyph-and-initials tile, so it reads as an action rather
 * than a fourth club. `onPressNewClub` is optional so this component stays
 * usable without it, but every real caller passes it.
 *
 * Selection reads via `MahjongTile`'s own solid accent-tile treatment
 * (`selected`) rather than a leading dot, which had nowhere clean to sit on
 * a tile.
 *
 * Still wraps onto as many lines as it needs rather than scrolling
 * horizontally — selecting a chip is the only way to arm the header's
 * Manage control, so a chip clipped or scrolled off-screen would hide a
 * member's only route into that club. Wrapping means nothing is ever
 * hidden, at any club count — the New club tile included, which was tried
 * as a trailing chip once before and removed specifically because the row
 * used to scroll and clip it; that reason no longer applies.
 */
export default function ClubChips({
  chips,
  selected,
  onSelect,
  onPressNewClub,
  unreadByClub,
}: {
  chips: Chip[];
  selected: string;
  onSelect: (id: string) => void;
  onPressNewClub?: () => void;
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
            style={styles.tile}
          >
            <View style={styles.tileWrap} testID={`chip-glyph-${chip.id}`}>
              <MahjongTile
                suit={glyphForClub(chip.id)}
                size="chip"
                selected={active}
                label={initialsFrom(chip.label)}
              />
              <View style={styles.badgeWrap}>
                <UnreadBadge count={count} />
              </View>
            </View>
            <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={2}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
      {onPressNewClub ? (
        <Pressable
          onPress={onPressNewClub}
          accessibilityRole="button"
          accessibilityLabel="Start a club"
          style={styles.tile}
        >
          <View style={styles.newClubTile}>
            <PlusIcon size={16} color={colors.text} />
          </View>
          <Text style={styles.label} numberOfLines={1}>
            New club
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
  },
  tile: {
    alignItems: 'center',
    gap: space[1],
    width: 64,
  },
  tileWrap: {
    position: 'relative',
  },
  // Outlined rather than filled — the same treatment PlusButton uses — so
  // this tile reads as an action, not as a fourth club.
  newClubTile: {
    width: 48,
    height: 60,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    borderWidth: control.hairline,
    borderColor: colors.textMuted,
  },
  badgeWrap: {
    position: 'absolute',
    top: -6,
    right: -8,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
    textAlign: 'center',
  },
  labelActive: { color: colors.accentColor },
});
