import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import Tag from '../Tag';
import AttachmentGrid from '../messages/AttachmentGrid';
import HeartPill from './HeartPill';
import CommentsPeek from './CommentsPeek';
import { avatarColorFor } from '../../lib/friends';
import { isHostRole, memberInitials } from '../../lib/members';
import { commentCountLabel, postTimeLabel, type FeedPost } from '../../lib/board';
import { colors, type } from '../../lib/theme';

type Props = {
  post: FeedPost;
  attachmentUrls: Record<string, string>;
  onOpen: () => void;
  onToggleHeart: () => void;
  hearting: boolean;
};

const MAX_LINES = 8;
const MAX_CHARS = 600;

/**
 * react-native-web does not report line counts, so on web "long" is judged
 * from the text itself (more than 8 newline-separated lines, or > 600
 * chars); native refines it with the measured line count.
 */
function looksLong(body: string): boolean {
  return body.split('\n').length > MAX_LINES || body.length > MAX_CHARS;
}

export default function PostCard({ post, attachmentUrls, onOpen, onToggleHeart, hearting }: Props) {
  const [measuredLong, setMeasuredLong] = useState(false);
  const long = measuredLong || looksLong(post.body);
  const showHost = post.authorRole !== null && isHostRole(post.authorRole);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: avatarColorFor(post.authorId) }]}>
          <Text style={styles.initials}>{memberInitials(post.authorName)}</Text>
        </View>
        <View style={styles.headerText}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              {post.authorName}
            </Text>
            {showHost ? <Tag size="small">Host</Tag> : null}
            {post.isAnnouncement ? (
              <Tag size="small" variant="accent2">
                Announcement
              </Tag>
            ) : null}
          </View>
          <Text style={styles.time}>{postTimeLabel(post.createdAt)}</Text>
        </View>
        {post.unread ? <View style={styles.dot} testID="unread-dot" accessibilityLabel="Unread" /> : null}
      </View>

      {post.body.trim() !== '' ? (
        <View>
          <Text
            style={styles.body}
            numberOfLines={MAX_LINES}
            onTextLayout={(e) => {
              if (e.nativeEvent.lines.length > MAX_LINES) setMeasuredLong(true);
            }}
          >
            {post.body}
          </Text>
          {long ? (
            <Pressable onPress={onOpen} accessibilityRole="button" style={styles.more}>
              <Text style={styles.moreText}>More</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {post.attachments.length > 0 ? (
        <AttachmentGrid attachments={post.attachments} urls={attachmentUrls} />
      ) : null}

      <View style={styles.footer}>
        <HeartPill count={post.heartCount} hearted={post.heartedByMe} busy={hearting} onPress={onToggleHeart} />
        <Pressable onPress={onOpen} accessibilityRole="button" style={styles.commentLink}>
          <Text style={styles.commentText}>{commentCountLabel(post.replyCount)}</Text>
        </Pressable>
      </View>

      {post.replyCount > 0 ? (
        <CommentsPeek comments={post.recentComments} total={post.replyCount} onPress={onOpen} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.divider },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: type.bodyBold, fontSize: 16, color: '#fff' },
  headerText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  name: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text, flexShrink: 1 },
  time: { fontFamily: type.bodyRegular, fontSize: 14, color: colors.textMuted },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent[600] },
  body: { fontFamily: type.bodyRegular, fontSize: 17, lineHeight: 24, color: colors.text },
  more: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  moreText: { fontFamily: type.bodyBold, fontSize: 16, color: colors.accent[700] },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  commentLink: { minHeight: 44, justifyContent: 'center' },
  commentText: { fontFamily: type.bodyBold, fontSize: 16, color: colors.accent[700] },
});
