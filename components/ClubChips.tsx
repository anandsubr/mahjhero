import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PeopleIcon } from './icons';
import UnreadBadge from './UnreadBadge';
import { ALL_CLUBS, initialsFrom } from '../lib/dashboard';
import type { Chip } from '../lib/dashboard';
import { unreadSuffix } from '../lib/messages';
import { colors, space, type } from '../lib/theme';

/**
 * The artboard's club switcher, restyled icon-over-label — the same shape
 * components/TabBar.tsx uses for every tab, and the one true icon-over-text
 * pattern this app already had. Each club gets a small avatar carrying its
 * initials (the same fill/initials treatment DashboardHeader's and
 * ThreadAvatar's own club avatars use); "All clubs" has no club to initial,
 * so it gets a generic people glyph instead, on the cooler accent2 fill
 * ThreadAvatar already reserves for "more than one person" (its `group`
 * kind).
 *
 * Selection reads as a ring around the avatar rather than the previous
 * leading dot, which had nowhere clean to sit on a tile.
 *
 * Still wraps onto as many lines as it needs rather than scrolling
 * horizontally — selecting a chip is the only way to arm the header's
 * Manage control, so a chip clipped or scrolled off-screen would hide a
 * member's only route into that club. Wrapping means nothing is ever
 * hidden, at any club count.
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
            style={styles.tile}
          >
            <View style={styles.avatarWrap}>
              <View
                style={[
                  styles.avatar,
                  chip.id === ALL_CLUBS ? styles.avatarAllClubs : styles.avatarClub,
                  active ? styles.avatarActive : null,
                ]}
              >
                {chip.id === ALL_CLUBS ? (
                  <PeopleIcon size={16} color={colors.bg} />
                ) : (
                  <Text style={styles.avatarInitials}>{initialsFrom(chip.label)}</Text>
                )}
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
  // Same club/group fill split ThreadAvatar's own kinds use (club: warm
  // accent[700]; group/"more than one": cool accent2[600]) — "All clubs"
  // is closer in meaning to a group than to any one club.
  avatarClub: { backgroundColor: colors.accent[700] },
  avatarAllClubs: { backgroundColor: colors.accent2[600] },
  avatarActive: { borderColor: colors.accentColor },
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
