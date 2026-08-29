import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTile from './DateTile';
import UnreadBadge from './UnreadBadge';
import { MessageIcon, PersonIcon } from './icons';
import {
  kindLabel,
  messagePreview,
  rowTitle,
  unreadSuffix,
  type ThreadListRow,
} from '../lib/messages';
import { colors, radius, space, type } from '../lib/theme';

/**
 * One row of the messages list. Knows nothing about navigation — the screen
 * decides what a press means, which is what lets a club thread with no id
 * yet go through open_thread_for_club on the way.
 *
 * The left tile is what distinguishes the four kinds at a glance:
 *   club    the chat glyph
 *   game    the existing DateTile, reused rather than a second 52x70 tile
 *   direct  nothing borrowed — a person glyph
 *   group   a person glyph too, no distinct tile of its own
 */
export default function ThreadRow({
  row,
  onPress,
}: {
  row: ThreadListRow;
  onPress: () => void;
}) {
  const kicker = row.club_name
    ? `${row.club_name} · ${kindLabel(row.kind)}`
    : kindLabel(row.kind);
  const title = rowTitle(row);

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
      <View style={styles.tile}>
        {row.kind === 'game' && row.event_starts_at ? (
          <DateTile
            testID="thread-date-tile"
            startsAt={row.event_starts_at}
            timezone={row.event_timezone ?? 'UTC'}
          />
        ) : row.kind === 'club' ? (
          <View style={styles.glyph}>
            <MessageIcon color={colors.accentColor} />
          </View>
        ) : (
          <View style={styles.glyph}>
            <PersonIcon color={colors.accentColor} />
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.kicker} numberOfLines={1}>
          {kicker}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {messagePreview(row)}
        </Text>
      </View>

      <View style={styles.trailing}>
        <UnreadBadge count={row.unread} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
  },
  tile: { flexShrink: 0 },
  glyph: {
    width: 52,
    height: 70,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  kicker: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  preview: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 2,
  },
  trailing: { flexShrink: 0, alignItems: 'flex-end' },
});
