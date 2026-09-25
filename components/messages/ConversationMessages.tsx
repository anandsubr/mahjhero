import { StyleSheet, Text } from 'react-native';
import AnnouncementCard from './AnnouncementCard';
import MessageGroup from './MessageGroup';
import { groupMessages, groupSeparatorParts, type ThreadMessage } from '../../lib/messages';
import { colors, type } from '../../lib/theme';

type Props = {
  /** Oldest first. */
  messages: ThreadMessage[];
  viewerId: string;
  onReply: (message: ThreadMessage) => void;
  attachmentUrls?: Record<string, string>;
};

/**
 * A conversation's messages as the Messages 2a handoff lays them out: a
 * centred "**Today** 7:26 pm" line wherever `startsNewGroup` puts a break,
 * then runs of one person's messages (`groupMessages`), with announcements
 * standing alone. Shared by the thread screen and the club-post screen; the
 * caller supplies the ScrollView around it.
 */
export default function ConversationMessages({
  messages,
  viewerId,
  onReply,
  attachmentUrls,
}: Props) {
  return (
    <>
      {groupMessages(messages, viewerId).map((item) => {
        if (item.kind === 'separator') {
          const parts = groupSeparatorParts(item.createdAt);
          return (
            <Text key={item.key} testID="conversation-separator" style={styles.separator}>
              <Text style={styles.separatorDay}>{parts?.day ?? ''}</Text>
              {parts?.rest ?? ''}
            </Text>
          );
        }
        if (item.kind === 'announcement') {
          return (
            <AnnouncementCard
              key={item.key}
              message={item.message}
              onReply={onReply}
              attachmentUrls={attachmentUrls}
            />
          );
        }
        return (
          <MessageGroup
            key={item.key}
            messages={item.messages}
            mine={item.mine}
            authorName={item.authorName}
            onReply={onReply}
            attachmentUrls={attachmentUrls}
          />
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  // neutral[700] on colors.bg -- the handoff's own token for this line.
  separator: {
    alignSelf: 'center',
    paddingTop: 6,
    fontFamily: type.bodyRegular,
    fontSize: 12,
    color: colors.neutral[700],
    textAlign: 'center',
  },
  separatorDay: { fontFamily: type.bodyBold },
});
