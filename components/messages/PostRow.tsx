import { Pressable, StyleSheet, Text, View } from 'react-native';
import Tag from '../Tag';
import UnreadBadge from '../UnreadBadge';
import {
  postTitle,
  relativeTimestamp,
  replyCountLabel,
  unreadSuffix,
  type ClubPost,
} from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

type Props = { post: ClubPost; onPress: () => void };

/**
 * One row on the board.
 *
 * An announcement is visually distinct (the accent[700] rail, the same
 * pairing components/UnreadBadge.tsx's pill is already pinned against
 * colors.surface for) but sorts by recency like everything else -- it does
 * NOT pin. With no unpin affordance, a pinned announcement would sit
 * permanently above this morning's post, and the top of the board would
 * become an archive of stale ones rather than a live one.
 */
export default function PostRow({ post, onPress }: Props) {
  const title = postTitle(post);
  const author = post.author_name ?? 'Someone';
  const replies = replyCountLabel(post.reply_count);
  const when = relativeTimestamp(post.last_activity_at);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // ONE label: accessibilityLabel on a Pressable REPLACES the name
      // computed from its children in react-native-web rather than merging
      // with it (the same trap ThreadRow.tsx's own docstring records), so
      // everything a screen reader needs -- announcement, title, author,
      // reply count, timestamp, unread count -- is composed here instead of
      // left on the Tag/UnreadBadge/Text children, none of which reach
      // assistive tech on their own inside this Pressable.
      accessibilityLabel={
        [
          post.is_announcement ? 'Announcement:' : null,
          title,
          `by ${author}`,
          replies,
          when,
        ]
          .filter(Boolean)
          .join(', ') + unreadSuffix(post.unread)
      }
      style={[styles.row, post.is_announcement ? styles.announcement : null]}
    >
      <View style={styles.head}>
        {post.is_announcement ? <Tag variant="accent2">Announcement</Tag> : null}
        <View style={styles.spacer} />
        <Text style={styles.when}>{when}</Text>
        <UnreadBadge count={post.unread} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {author} · {replies}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    gap: space[1],
  },
  // accent[700] against colors.surface is already pinned in lib/theme.test.ts
  // ("unread badge shape clears non-text contrast against its ground",
  // 5.08:1, clearing WCAG 1.4.11's 3:1) -- reused here as a non-text rail
  // rather than a new pairing.
  announcement: { borderLeftWidth: 3, borderLeftColor: colors.accent[700] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  spacer: { flex: 1 },
  when: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
  // colors.text on colors.surface: the same pairing
  // app/messages/[threadId].tsx's `namePillText` already reads 12.40:1 on,
  // not a new one.
  title: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  // colors.textMuted on colors.surface: pinned in lib/theme.test.ts
  // ("muted text clears AA on both grounds it is drawn on" -- 4.58:1 on a
  // card).
  meta: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
});
