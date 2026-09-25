import { Pressable, StyleSheet, Text, View } from 'react-native';
import Tag from '../Tag';
import AttachmentGrid from './AttachmentGrid';
import { announcementBody, quoteStub, type ThreadMessage } from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

type Props = {
  message: ThreadMessage;
  onReply: (message: ThreadMessage) => void;
  /** `storage_path` -> signed URL, resolved once per screen load by the
   *  caller -- see AttachmentGrid's own `urls` prop docstring. */
  attachmentUrls?: Record<string, string>;
};

/**
 * An announcement in a conversation: a full-width card addressed to
 * everyone, never grouped with a person's run of messages
 * (components/messages/MessageGroup.tsx) and never tailed like a person's
 * bubble, since it has no side to point from.
 *
 * Kept from the old MessageBubble's announcement treatment when the rest of
 * the conversation moved to the Messages 2a layout -- the handoff doesn't
 * cover announcements.
 */
export default function AnnouncementCard({ message: m, onReply, attachmentUrls = {} }: Props) {
  // An announcement's subject IS the body's first line (deriveSubject's own
  // contract) -- so printing `m.body` verbatim under a subject that already
  // said it once repeats it. Only what this card prints drops the duplicate.
  const displayBody = announcementBody(m.subject, m.body);

  return (
    <Pressable
      testID={`bubble-${m.id}`}
      onLongPress={() => onReply(m)}
      tabIndex={-1}
      style={styles.card}
    >
      <View style={styles.head}>
        <Tag variant="accent2">Announcement</Tag>
        {m.subject ? <Text style={styles.subject}>{m.subject}</Text> : null}
      </View>

      {/*
        Rendered from `reply_to`, not from `reply_to_id`. The key is `on
        delete set null`, so a reply can outlive what it answered -- and an
        empty quote box is worse than none.
      */}
      {m.reply_to ? (
        <Text testID="quote-stub" numberOfLines={1} style={styles.stub}>
          {quoteStub(m.reply_to)}
        </Text>
      ) : null}

      <AttachmentGrid attachments={m.attachments} urls={attachmentUrls} />

      {displayBody ? <Text style={styles.body}>{displayBody}</Text> : null}

      {/* The accessible twin of the long press -- see MessageGroup's HiddenReply. */}
      <Pressable
        onPress={() => onReply(m)}
        accessibilityRole="button"
        accessibilityLabel={`Reply to ${m.profiles?.display_name ?? 'this message'}`}
        style={styles.hiddenReply}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 14,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    gap: space[2],
    backgroundColor: colors.accent2[100],
    borderRadius: radius.lg,
  },
  head: { gap: space[2] },
  subject: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.accent2[800],
  },
  // accent2[800] on accent2[100] measures 9.12:1 -- whoever sent it, since
  // an organizer's own announcement is still on this ground. lib/theme.test.ts
  // pins the ratio.
  body: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 26,
    color: colors.accent2[800],
  },
  stub: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accent2[800],
    borderLeftWidth: 3,
    borderLeftColor: colors.accent2[500],
    paddingLeft: space[2],
  },
  hiddenReply: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
});
