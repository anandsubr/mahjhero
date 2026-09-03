import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlusIcon } from './icons';
import UnreadBadge from './UnreadBadge';
import { initialsFrom } from '../lib/dashboard';
import type { Chip } from '../lib/dashboard';
import { unreadSuffix } from '../lib/messages';
import { colors, control, space, type } from '../lib/theme';

/**
 * The artboard's club switcher, icon-over-label — the same shape
 * components/TabBar.tsx uses for every tab. Each club gets a small avatar
 * carrying its initials (the same fill/initials treatment DashboardHeader's
 * and ThreadAvatar's own club avatars use).
 *
 * No "All clubs" chip: it never represented a real club, and the row's own
 * visibility already carries that meaning (app/clubs/index.tsx draws it
 * exactly when nothing is filtered in). A trailing "New club" tile takes
 * its place at the end of the row — the outlined ⊕ treatment PlusButton
 * uses, not a club's solid initials fill, so it reads as an action rather
 * than a fourth club. `onPressNewClub` is optional so this component stays
 * usable without it, but every real caller passes it.
 *
 * Selection reads as a ring around the avatar rather than a leading dot,
 * which had nowhere clean to sit on a tile.
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
            <View style={styles.avatarWrap}>
              <View
                style={[styles.avatar, styles.avatarClub, active ? styles.avatarActive : null]}
              >
                <Text style={styles.avatarInitials}>{initialsFrom(chip.label)}</Text>
              </View>
              <View style={styles.badgeWrap}>
                <UnreadBadge count={count} />
              </View>
            </View>
            <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={1}>
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
          <View style={[styles.avatar, styles.avatarNewClub]}>
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
    width: 72,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarClub: { backgroundColor: colors.accent[700] },
  avatarActive: { borderColor: colors.accentColor },
  // Outlined rather than filled — the same treatment PlusButton uses — so
  // this tile reads as an action, not as a fourth club.
  avatarNewClub: {
    backgroundColor: 'transparent',
    borderWidth: control.hairline,
    borderColor: colors.textMuted,
  },
  avatarInitials: {
    fontFamily: type.bodyBold,
    fontSize: 13,
    color: colors.bg,
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
