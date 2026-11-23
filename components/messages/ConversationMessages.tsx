import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../Text';
import AnnouncementCard from './AnnouncementCard';
import MessageGroup from './MessageGroup';
import ActionSheet, { type SheetAction } from '../moderation/ActionSheet';
import { blockLabel, useModeration } from '../moderation/useModeration';
import { groupMessages, groupSeparatorParts, type ThreadMessage } from '../../lib/messages';
import { colors, type } from '../../lib/theme';

type Props = {
  /** Oldest first. */
  messages: ThreadMessage[];
  viewerId: string;
  onReply: (message: ThreadMessage) => void;
  attachmentUrls?: Record<string, string>;
  /** After a block: refetch, since the server now hides the person. */
  onBlocked?: (personId: string) => void;
};

/**
 * A conversation's messages as the Messages 2a handoff lays them out: a
 * centred "**Today** 7:26 pm" line wherever `startsNewGroup` puts a break,
 * then runs of one person's messages (`groupMessages`), with announcements
 * standing alone. Shared by the thread screen and the club-post screen; the
 * caller supplies the ScrollView around it.
 *
 * A long press on a message opens its action sheet: Reply, plus Report and
 * Block {name} on somebody else's message.
 */
export default function ConversationMessages({
  messages,
  viewerId,
  onReply,
  attachmentUrls,
  onBlocked,
}: Props) {
  const [actionsFor, setActionsFor] = useState<ThreadMessage | null>(null);
  const moderation = useModeration({ onBlocked });

  function actionsOf(m: ThreadMessage): SheetAction[] {
    const actions: SheetAction[] = [{ label: 'Reply', onPress: () => onReply(m) }];
    if (m.author_id !== viewerId) {
      const name = m.profiles?.display_name ?? null;
      actions.push(
        {
          label: 'Report',
          onPress: () => moderation.startReport('message', m.id, 'Report this message'),
        },
        {
          label: blockLabel(name),
          destructive: true,
          onPress: () => moderation.startBlock(m.author_id, name),
        },
      );
    }
    return actions;
  }

  return (
    <>
      {actionsFor ? (
        <ActionSheet actions={actionsOf(actionsFor)} onClose={() => setActionsFor(null)} />
      ) : null}
      {moderation.sheets}
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
              onActions={setActionsFor}
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
            onActions={setActionsFor}
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
