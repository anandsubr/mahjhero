import { Pressable, StyleSheet, Text, View } from 'react-native';
import UnreadBadge from './UnreadBadge';
import { CalendarIcon, PeopleIcon } from './icons';
import { initialsFrom } from '../lib/dashboard';
import {
  messagePreview,
  relativeTimestamp,
  rowSubtitle,
  rowTitle,
  unreadSuffix,
  type ThreadListRow,
} from '../lib/messages';
import { colors, space, type } from '../lib/theme';

const AVATAR_SIZE = 52;
/**
 * Where the divider starts: past the avatar and its gap from the row's own
 * left padding, so the hairline lines up with the text column rather than
 * running to the screen edge. Kept in sync with `styles.row`'s padding and
 * gap below by construction (both read from the same tokens) rather than by
 * a magic number.
 */
const DIVIDER_INSET = space[4] + AVATAR_SIZE + space[3];

/**
 * One row of the messages list, styled flat -- iOS Messages, not a card.
 * This is a deliberate departure from the `1C messages` artboard, which
 * specifies `class="card"` per row; the owner's call, made knowingly, once
 * pinning club threads at the top (see lib/messages.ts's
 * `orderThreadsForList`) made the "Recent | By club" sort control this
 * screen used to carry redundant. Uniform circular avatars are the point of
 * the change, so every kind gets the same size and shape here -- only the
 * avatar's fill and glyph/initials vary:
 *
 *   club    the club's own initials
 *   direct  the OTHER member's initials (this row's own title)
 *   group   a people glyph -- no single person to initial
 *   game    a calendar glyph, replacing the old DateTile (52x70, which does
 *           not fit a circular avatar); the game's date moves into the
 *           subtitle line instead, via lib/messages.ts's `rowSubtitle`.
 *
 * Knows nothing about navigation — the screen decides what a press means,
 * which is what lets a club thread with no id yet go through
 * open_thread_for_club on the way.
 */
export default function ThreadRow({
  row,
  onPress,
  showDivider = true,
}: {
  row: ThreadListRow;
  onPress: () => void;
  /** False on the list's last row, so the hairline does not trail it. */
  showDivider?: boolean;
}) {
  const title = rowTitle(row);
  const when = relativeTimestamp(row.last_message_at);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // The count is composed in here rather than left on UnreadBadge's own
      // <Text>: react-native-web's aria-label REPLACES the accessible name
      // computed from a Pressable's children, it does not merge with it, so
      // the badge nested below would otherwise never reach assistive tech.
      accessibilityLabel={`${title}${unreadSuffix(row.unread)}`}
      style={styles.row}
    >
      <Avatar row={row} title={title} />

      <View style={styles.body}>
        {/*
          iOS Messages, the reference this row is modelled on, puts the
          timestamp on the TITLE's own line, right-aligned, rather than in a
          separate full-height column -- a fixed-width column steals the
          same ~90px from every line (title, subtitle, preview) instead of
          only the one line that actually needs to make room for it. The
          title flexes and truncates; the timestamp and (when present) the
          unread badge take only the width they need and never truncate.
          The subtitle and preview below run the row's full width.
        */}
        <View testID="thread-title-row" style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.trailing}>
            {when ? (
              <Text testID="thread-timestamp" style={styles.timestamp}>
                {when}
              </Text>
            ) : null}
            <UnreadBadge count={row.unread} />
          </View>
        </View>
        <Text style={styles.subtitle} numberOfLines={1}>
          {rowSubtitle(row)}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {messagePreview(row)}
        </Text>
      </View>

      {showDivider ? <View testID="thread-divider" style={styles.divider} /> : null}
    </Pressable>
  );
}

function Avatar({ row, title }: { row: ThreadListRow; title: string }) {
  if (row.kind === 'club') {
    return (
      <View testID="thread-avatar-club" style={[styles.avatar, styles.avatarClub]}>
        <Text style={styles.avatarInitials}>{initialsFrom(row.club_name ?? '')}</Text>
      </View>
    );
  }
  if (row.kind === 'game') {
    return (
      <View testID="thread-avatar-game" style={[styles.avatar, styles.avatarGame]}>
        <CalendarIcon color={colors.bg} />
      </View>
    );
  }
  if (row.kind === 'group') {
    return (
      <View testID="thread-avatar-group" style={[styles.avatar, styles.avatarGroup]}>
        <PeopleIcon color={colors.bg} />
      </View>
    );
  }
  // direct
  return (
    <View testID="thread-avatar-direct" style={[styles.avatar, styles.avatarDirect]}>
      <Text style={styles.avatarInitials}>{initialsFrom(title)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    // The hairline divider below is positioned absolutely against this.
    position: 'relative',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Each kind's own fill, so the avatar column stays scannable even before
  // the title is read -- club and game share the warm accent family, direct
  // and group the cool one, distinguished within each pair by shade. Every
  // pairing below is pinned in lib/theme.test.ts.
  avatarClub: { backgroundColor: colors.accent[700] },
  avatarGame: { backgroundColor: colors.accent[600] },
  avatarDirect: { backgroundColor: colors.accent2[700] },
  avatarGroup: { backgroundColor: colors.accent2[600] },
  avatarInitials: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.bg,
  },
  body: { flex: 1, minWidth: 0 },
  // The title's own line: title flexes and truncates, the trailing group
  // (timestamp + badge) takes only the width it needs alongside it.
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  title: {
    flex: 1,
    minWidth: 0,
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  subtitle: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 1,
  },
  preview: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 1,
  },
  // Never truncates -- it shrinks to its own natural width instead of the
  // title's, so it stays fully readable while the title gives up the room.
  trailing: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: space[1] },
  timestamp: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  divider: {
    position: 'absolute',
    left: DIVIDER_INSET,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
  },
});
