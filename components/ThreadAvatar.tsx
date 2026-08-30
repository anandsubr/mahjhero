import { StyleSheet, Text, View } from 'react-native';
import { CalendarIcon, PeopleIcon } from './icons';
import { initialsFrom } from '../lib/dashboard';
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
 *   direct  the OTHER member's initials (the thread's own title)
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
}: {
  kind: ThreadKind;
  /** Club name (club) or the other member's/thread's title (direct).
   *  Ignored for game/group, which render a glyph instead of initials. */
  name: string;
  size?: number;
  testID?: string;
}) {
  const dim = { width: size, height: size, borderRadius: size / 2 };
  const glyphSize = Math.round(size * (24 / DEFAULT_SIZE));
  const initialsStyle = [
    styles.avatarInitials,
    { fontSize: Math.round(size * (18 / DEFAULT_SIZE)) },
  ];

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
  return (
    <View testID={testID ?? 'thread-avatar-direct'} style={[styles.avatar, dim, styles.avatarDirect]}>
      <Text style={initialsStyle}>{initialsFrom(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Each kind's own fill -- club and game share the warm accent family,
  // direct and group the cool one, distinguished within each pair by shade.
  // Every pairing is pinned in lib/theme.test.ts ("thread row avatars clear
  // contrast on their own fill").
  avatarClub: { backgroundColor: colors.accent[700] },
  avatarGame: { backgroundColor: colors.accent[600] },
  avatarDirect: { backgroundColor: colors.accent2[700] },
  avatarGroup: { backgroundColor: colors.accent2[600] },
  avatarInitials: {
    fontFamily: type.bodyBold,
    color: colors.bg,
  },
});
