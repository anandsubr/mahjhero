import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import ThreadAvatar from '../ThreadAvatar';
import AttachmentGrid from './AttachmentGrid';
import { ReplyIcon } from '../icons';
import { quoteStub, type ThreadMessage } from '../../lib/messages';
import { colors, radius, type } from '../../lib/theme';

type Props = {
  /** One run of consecutive messages from one person -- see `groupMessages`. */
  messages: ThreadMessage[];
  mine: boolean;
  authorName: string;
  onReply: (message: ThreadMessage) => void;
  /** `storage_path` -> signed URL, resolved once per screen load by the
   *  caller -- see AttachmentGrid's own `urls` prop docstring. */
  attachmentUrls?: Record<string, string>;
};

// The Reply chip's height and the gap above it. The avatar is bottom-aligned
// with the whole run, so it is lifted by exactly this much to sit beside the
// last line of text rather than beside the chip (the handoff's own layout).
const CHIP_HEIGHT = 24;
const ROW_GAP = 6;

/**
 * One run of messages from one person, drawn the Messages 2a way.
 *
 *   Somebody else: a small avatar and their name once per run, then each
 *   message as plain text (no bubble) and any images, with a visible Reply
 *   chip under the run's last message.
 *   You: right-aligned accent bubbles with no name or avatar, the corner
 *   nearest the next bubble tightened so a run reads as one stack.
 *
 * Every message is still its own long-press target for quoting it, and
 * every message keeps an accessible reply control -- the visible chip for
 * the last one in someone else's run, a visually hidden one otherwise.
 */
export default function MessageGroup({
  messages,
  mine,
  authorName,
  onReply,
  attachmentUrls = {},
}: Props) {
  if (mine) {
    return (
      <View style={styles.mineGroup}>
        {messages.map((m, i) => (
          <Pressable
            key={m.id}
            testID={`bubble-${m.id}`}
            onLongPress={() => onReply(m)}
            tabIndex={-1}
            style={styles.mineMessage}
          >
            {m.body || m.reply_to ? (
              <View style={[styles.bubble, i > 0 ? styles.bubbleFollowOn : null]}>
                {m.reply_to ? (
                  <Text testID="quote-stub" numberOfLines={1} style={[styles.stub, styles.stubMine]}>
                    {quoteStub(m.reply_to)}
                  </Text>
                ) : null}
                {m.body ? <Text style={styles.bodyMine}>{m.body}</Text> : null}
              </View>
            ) : null}
            <AttachmentGrid attachments={m.attachments} urls={attachmentUrls} />
            <HiddenReply message={m} onReply={onReply} />
          </Pressable>
        ))}
      </View>
    );
  }

  const lastIndex = messages.length - 1;
  return (
    <View style={styles.theirsGroup}>
      <View style={styles.avatar}>
        <ThreadAvatar kind="direct" name={authorName} size={28} initialsSize={12} testID="sender-avatar" />
      </View>
      <View style={styles.theirsColumn}>
        <Text style={styles.author}>{authorName}</Text>
        {messages.map((m, i) => (
          <Pressable
            key={m.id}
            testID={`bubble-${m.id}`}
            onLongPress={() => onReply(m)}
            tabIndex={-1}
            style={styles.theirsMessage}
          >
            {m.reply_to ? (
              <Text testID="quote-stub" numberOfLines={1} style={styles.stub}>
                {quoteStub(m.reply_to)}
              </Text>
            ) : null}
            {m.body ? <Text style={styles.body}>{m.body}</Text> : null}
            <AttachmentGrid attachments={m.attachments} urls={attachmentUrls} />
            {i === lastIndex ? (
              <View style={styles.chipRow}>
                <Pressable
                  onPress={() => onReply(m)}
                  accessibilityRole="button"
                  accessibilityLabel={`Reply to ${authorName || 'this message'}`}
                  hitSlop={10}
                  style={({ pressed }) => [styles.replyChip, pressed ? styles.replyChipPressed : null]}
                >
                  <ReplyIcon size={14} color={colors.neutral[700]} />
                  <Text style={styles.replyChipText}>Reply</Text>
                </Pressable>
              </View>
            ) : (
              <HiddenReply message={m} onReply={onReply} />
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/**
 * The accessible twin of a message's long press, for a message with no
 * visible Reply chip: assistive tech and keyboards cannot long-press, so
 * this carries the same action. Clipped to 1x1 rather than hidden, so it
 * stays in the accessibility tree and the Tab order.
 */
function HiddenReply({
  message,
  onReply,
}: {
  message: ThreadMessage;
  onReply: (message: ThreadMessage) => void;
}) {
  return (
    <Pressable
      onPress={() => onReply(message)}
      accessibilityRole="button"
      accessibilityLabel={`Reply to ${message.profiles?.display_name ?? 'this message'}`}
      style={styles.hiddenReply}
    />
  );
}

const styles = StyleSheet.create({
  theirsGroup: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 14,
  },
  avatar: { marginBottom: CHIP_HEIGHT + ROW_GAP },
  theirsColumn: { flex: 1, minWidth: 0, gap: ROW_GAP },
  theirsMessage: { gap: ROW_GAP, alignItems: 'flex-start' },
  author: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: colors.accent2[700],
  },
  body: {
    fontFamily: type.bodyRegular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  chipRow: { flexDirection: 'row', gap: ROW_GAP },
  replyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: CHIP_HEIGHT,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  replyChipPressed: { backgroundColor: colors.surface },
  replyChipText: {
    fontFamily: type.bodySemiBold,
    fontSize: 13,
    color: colors.neutral[700],
  },
  mineGroup: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    maxWidth: '78%',
    paddingRight: 14,
    gap: 3,
  },
  mineMessage: { alignItems: 'flex-end', gap: 3 },
  // accent[700] under white-ish text: colors.bg on accent[700] reads 5.72:1
  // (pinned in lib/theme.test.ts), where the brighter accentColor fails AA.
  // Single or first bubble: 20/20/6/20 -- the tight bottom-right corner is
  // the tail. `bubbleFollowOn` tightens the top-right too, where it meets
  // the bubble above.
  bubble: {
    backgroundColor: colors.accent[700],
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomRightRadius: 6,
    borderBottomLeftRadius: 20,
  },
  bubbleFollowOn: { borderTopRightRadius: 6 },
  bodyMine: {
    fontFamily: type.bodyRegular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.bg,
  },
  stub: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    color: colors.textMuted,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent2[500],
    paddingLeft: 8,
  },
  stubMine: { color: colors.bg, borderLeftColor: colors.bg, marginBottom: 4 },
  hiddenReply: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
});
