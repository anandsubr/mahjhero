import { Pressable, StyleSheet, Text, View } from 'react-native';
import ThreadAvatar from './ThreadAvatar';
import { ChevronLeftIcon, MoreVerticalIcon, PencilIcon, PlusIcon } from './icons';
import type { ThreadKind } from '../lib/messages';
import { colors, radius, type } from '../lib/theme';

type Props = {
  /** Draws the back chevron. Omitted, the chevron's slot collapses. */
  onBack?: () => void;
  /** Distinct from any tab's own name, e.g. "Back to Messages". */
  backLabel?: string;
  /** Null until the thread/club has loaded -- back and `action` render regardless. */
  kind: ThreadKind | null;
  title: string;
  /** A club's id, to draw it as its own mahjong tile rather than a circle. */
  clubId?: string | null;
  /** Overrides the avatar's testID (default `thread-header-avatar-<kind>`). */
  avatarTestID?: string;
  /** The line under the title, e.g. "4 members" or a club's rhythm. */
  subtitle?: string | null;
  /**
   * Makes the avatar and title one control -- the members panel for a
   * conversation, managing the club for a club header. Omitted, both are
   * plain: a control that looks tappable and does nothing is worse than none.
   */
  onOpenDetails?: () => void;
  /** Accessible name for the avatar/title control. */
  detailsLabel?: string;
  /** Draws a small pencil after the title -- "tap the name to manage". */
  detailsHint?: 'pencil';
  /** Draws the "⋮" overflow button, opening the same details, with this label. */
  overflowLabel?: string;
  /** A primary action in the right slot instead of "⋮" -- "Add a game", "New post". */
  action?: { icon: 'plus'; label: string; onPress: () => void };
  /**
   * `edge`: the conversation screens, where the header runs the full width
   * and sets its own side padding. `inset`: a screen whose padded content
   * column already supplies the side margins.
   */
  variant?: 'edge' | 'inset';
};

/**
 * The compact one-row header from the Messages 2a handoff: back chevron,
 * a 40pt avatar (or a club's own mahjong tile), the name with an optional
 * line under it, and one control on the right, over a hairline divider.
 *
 * Shared by the conversation screens and every screen that heads itself
 * with one club's identity (components/DashboardHeader.tsx's "Your club"
 * shape, the club board, the new-post screen) -- one header pattern rather
 * than the large centred tile and name pill those used to carry.
 */
export default function CompactHeader({
  onBack,
  backLabel,
  kind,
  title,
  clubId,
  avatarTestID,
  subtitle,
  onOpenDetails,
  detailsLabel,
  detailsHint,
  overflowLabel,
  action,
  variant = 'edge',
}: Props) {
  const identity =
    kind !== null ? (
      <>
        <ThreadAvatar
          kind={kind}
          name={title}
          size={40}
          initialsSize={17}
          testID={avatarTestID ?? `thread-header-avatar-${kind}`}
          asTile={kind === 'club' && !!clubId}
          clubId={clubId ?? undefined}
          tileSize="section"
        />
        <View style={styles.titleBlock}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            {onOpenDetails && detailsHint === 'pencil' ? (
              <PencilIcon size={14} color={colors.accentColor} />
            ) : null}
          </View>
          {subtitle ? (
            <Text numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </>
    ) : null;

  return (
    <View style={[styles.header, variant === 'inset' ? styles.inset : styles.edge]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}
        >
          <ChevronLeftIcon color={colors.text} size={24} />
        </Pressable>
      ) : null}

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

      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [styles.side, pressed ? styles.pressed : null]}
        >
          <PlusIcon size={24} color={colors.text} />
        </Pressable>
      ) : identity && onOpenDetails && overflowLabel ? (
        <Pressable
          onPress={onOpenDetails}
          accessibilityRole="button"
          accessibilityLabel={overflowLabel}
          style={({ pressed }) => [styles.side, pressed ? styles.pressed : null]}
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
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  edge: {
    paddingTop: 6,
    paddingRight: 12,
    paddingBottom: 10,
    paddingLeft: 8,
  },
  // The chevron's own 40pt box already centres its glyph, so it can sit
  // right on the column's edge.
  inset: { paddingBottom: 10 },
  back: {
    width: 40,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  side: {
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    flexShrink: 1,
    minWidth: 0,
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
