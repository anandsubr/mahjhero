import { Pressable, StyleSheet, Text, View } from 'react-native';
import ThreadAvatar from '../ThreadAvatar';
import { ChevronLeftIcon, MoreVerticalIcon } from '../icons';
import type { ThreadKind } from '../../lib/messages';
import { colors, radius, type } from '../../lib/theme';

type Props = {
  onBack: () => void;
  /** Distinct from the Messages tab's own name, e.g. "Back to Messages". */
  backLabel: string;
  /** Null until the thread has loaded -- the back control renders regardless. */
  kind: ThreadKind | null;
  title: string;
  /** A club's id, to draw it as its own mahjong tile rather than a circle --
   *  the same tile the board shows for it. */
  clubId?: string | null;
  /** The muted line under the title, e.g. "4 members". Omitted when null. */
  subtitle?: string | null;
  /**
   * Opens whatever "who's in this conversation" means for this thread (the
   * members panel, for a group or direct thread). When given, the avatar and
   * title become one control and the overflow button appears; when omitted,
   * both are plain and the overflow button is not drawn at all -- a control
   * that looks tappable and does nothing is worse than none.
   */
  onOpenDetails?: () => void;
  /** Accessible name for the avatar/title control. */
  detailsLabel?: string;
};

/**
 * The Messages 2a handoff's compact conversation header: back chevron,
 * a 40pt avatar, the name with an optional status line under it, and an
 * overflow button, all in one row over a hairline divider. Replaces the
 * large centred avatar and name pill the thread and club-post screens used
 * to carry.
 *
 * No presence dot and no "Active now": the app has no presence data yet,
 * and a status that is always "Active now" would be a lie.
 */
export default function ConversationHeader({
  onBack,
  backLabel,
  kind,
  title,
  clubId,
  subtitle,
  onOpenDetails,
  detailsLabel,
}: Props) {
  const identity =
    kind !== null ? (
      <>
        <ThreadAvatar
          kind={kind}
          name={title}
          size={40}
          initialsSize={17}
          testID={`thread-header-avatar-${kind}`}
          asTile={kind === 'club' && !!clubId}
          clubId={clubId ?? undefined}
          tileSize="section"
        />
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </>
    ) : null;

  return (
    <View style={styles.header}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}
      >
        <ChevronLeftIcon color={colors.text} size={24} />
      </Pressable>

      {identity && onOpenDetails ? (
        <Pressable
          onPress={onOpenDetails}
          accessibilityRole="button"
          accessibilityLabel={detailsLabel}
          style={styles.identity}
        >
          {identity}
        </Pressable>
      ) : (
        <View style={styles.identity}>{identity}</View>
      )}

      {identity && onOpenDetails ? (
        <Pressable
          onPress={onOpenDetails}
          accessibilityRole="button"
          accessibilityLabel="Conversation options"
          style={({ pressed }) => [styles.more, pressed ? styles.pressed : null]}
        >
          <MoreVerticalIcon color={colors.text} size={22} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 6,
    paddingRight: 12,
    paddingBottom: 10,
    paddingLeft: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  back: {
    width: 40,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.surface },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  titleBlock: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: type.bodyBold,
    fontSize: 17,
    lineHeight: 20,
    color: colors.text,
  },
  subtitle: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    lineHeight: 16,
    color: colors.accent2[700],
  },
});
