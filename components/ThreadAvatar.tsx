import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { CalendarIcon, PeopleIcon } from './icons';
import MahjongTile from './MahjongTile';
import { glyphForClub, initialsFrom } from '../lib/dashboard';
import { avatarColorsFor } from '../lib/friends';
import type { ThreadKind } from '../lib/messages';
import { colors, type } from '../lib/theme';

/** components/ThreadRow.tsx's own list-row size -- the default here so a
 *  caller that doesn't pass `size` gets byte-identical output to before this
 *  was factored out. */
const DEFAULT_SIZE = 52;

/**
 * One kind's avatar -- club/direct initials, or a game/group glyph --
 * factored out of components/ThreadRow.tsx so the thread screen's header
 * (app/messages/[threadId].tsx) can reuse the exact same treatment at a
 * larger size instead of a second copy that can drift from the list row's.
 *
 *   club    the club's own initials
 *   direct  the OTHER member's initials (the thread's own title), in
 *           that person's soft avatar pair -- see `personId`
 *   group   a people glyph -- no single person to initial
 *   game    a calendar glyph
 *
 * `size` scales the glyph and initials proportionally to the 52px list-row
 * defaults (24px glyph, 18px initials) so a caller sizing the avatar up for
 * the header gets a legible, not just a bigger, badge rather than the same
 * small glyph adrift in more circle. Every fill below is the same token
 * ThreadRow.test.tsx and lib/theme.test.ts already pin, reused rather than
 * re-picked here.
 */
export default function ThreadAvatar({
  kind,
  name,
  size = DEFAULT_SIZE,
  testID,
  asTile = false,
  clubId,
  initialsSize,
  tileSize = 'chip',
  personId,
}: {
  kind: ThreadKind;
  /** Club name (club) or the other member's/thread's title (direct).
   *  Ignored for game/group, which render a glyph instead of initials. */
  name: string;
  size?: number;
  testID?: string;
  /** Opt-in: renders `kind="club"` as a mahjong tile (this club's own
   *  stable glyph + initials) instead of the plain circle every other
   *  caller still gets. Default false so a caller that doesn't opt in is
   *  unaffected — including any non-club `kind` (direct/group/game), which
   *  always stays circular regardless of this prop. components/ThreadRow.tsx
   *  now opts in for its own club rows too (`asTile={row.kind === 'club'}`),
   *  so club rows in the Messages list render the tile form; only the
   *  non-club kinds it also renders keep the circle. Ignored for any kind
   *  other than 'club'. */
  asTile?: boolean;
  /** Required (in practice) whenever `asTile` is true and `kind==='club'`
   *  — the tile's glyph is derived from this, not from `name`. */
  clubId?: string;
  /** Overrides the proportional initials size -- the conversation screen's
   *  small sender avatars and compact header set theirs from the Messages
   *  2a handoff (12px at 28pt, 17px at 40pt) rather than the list-row ratio. */
  initialsSize?: number;
  /** The tile's size when `asTile` applies. `"section"` (30x40, glyph only,
   *  no initials) fits the compact conversation header's 40pt avatar slot,
   *  where the club's name already sits right beside it. */
  tileSize?: 'chip' | 'section';
  /** direct only: the person's profile id, so their avatar is the same soft
   *  pair (lib/friends.ts's avatarColorsFor) as on Members, the board and
   *  everywhere else. The conversation screen's sender avatars have it; the
   *  thread list and header do not (fetch_my_threads returns only the other
   *  member's name), so they fall back to hashing `name` -- stable, but not
   *  guaranteed to match that person's id-keyed tint elsewhere. */
  personId?: string;
}) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  const glyphSize = Math.round(size * (24 / DEFAULT_SIZE));
  const initialsStyle = [
    styles.avatarInitials,
    { fontSize: initialsSize ?? Math.round(size * (18 / DEFAULT_SIZE)) },
  ];

  if (kind === 'club' && asTile && clubId) {
    return (
      <View testID={testID ?? 'thread-avatar-club-tile'}>
        <MahjongTile
          suit={glyphForClub(clubId)}
          size={tileSize}
          label={initialsFrom(name)}
        />
      </View>
    );
  }
  if (kind === 'club') {
    return (
      <View testID={testID ?? 'thread-avatar-club'} style={[styles.avatar, dim, styles.avatarClub]}>
        <Text style={initialsStyle}>{initialsFrom(name)}</Text>
      </View>
    );
  }
  if (kind === 'game') {
    return (
      <View testID={testID ?? 'thread-avatar-game'} style={[styles.avatar, dim, styles.avatarGame]}>
        <CalendarIcon color={colors.bg} size={glyphSize} />
      </View>
    );
  }
  if (kind === 'group') {
    return (
      <View testID={testID ?? 'thread-avatar-group'} style={[styles.avatar, dim, styles.avatarGroup]}>
        <PeopleIcon color={colors.bg} size={glyphSize} />
      </View>
    );
  }
  // direct
  const pair = avatarColorsFor(personId ?? name);
  return (
    <View
      testID={testID ?? 'thread-avatar-direct'}
      style={[styles.avatar, dim, { backgroundColor: pair.bg }]}
    >
      <Text style={[initialsStyle, { color: pair.fg }]}>{initialsFrom(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Each non-person kind's own fill -- club and game the warm accent
  // family, group the cool one. Every pairing is pinned in
  // lib/theme.test.ts ("thread row avatars clear contrast on their own
  // fill"). A direct thread is a person, so it takes that person's soft
  // avatar pair instead (inline above), pinned there too.
  avatarClub: { backgroundColor: colors.accent[700] },
  avatarGame: { backgroundColor: colors.accent[600] },
  avatarGroup: { backgroundColor: colors.accent2[600] },
  avatarInitials: {
    fontFamily: type.bodyBold,
    color: colors.bg,
  },
});
