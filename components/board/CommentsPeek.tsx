import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { avatarColorsFor } from '../../lib/friends';
import { memberInitials } from '../../lib/members';
import type { FeedComment } from '../../lib/board';
import { colors, type } from '../../lib/theme';

type Props = {
  /** Oldest-first, at most the two most recent replies. */
  comments: FeedComment[];
  total: number;
  onPress: () => void;
};

/** The last couple of replies under a post; pressing opens the post. */
export default function CommentsPeek({ comments, total, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open post, ${total} ${total === 1 ? 'comment' : 'comments'}`}
      style={styles.block}
    >
      {comments.map((c) => (
        <View key={c.id} style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: avatarColorsFor(c.authorId).bg }]}>
            <Text style={[styles.initials, { color: avatarColorsFor(c.authorId).fg }]}>{memberInitials(c.authorName)}</Text>
          </View>
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={1}>
              {c.authorName}
            </Text>
            <Text style={styles.body} numberOfLines={2}>
              {c.body.trim() !== '' ? c.body : 'Photo'}
            </Text>
          </View>
        </View>
      ))}
      {total > comments.length ? <Text style={styles.viewAll}>{`View all ${total} comments`}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surface, borderRadius: 18, padding: 14, gap: 12 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: type.bodyBold, fontSize: 12 },
  text: { flex: 1, minWidth: 0 },
  name: { fontFamily: type.bodyBold, fontSize: 14, color: colors.accent[700] },
  body: { fontFamily: type.bodyRegular, fontSize: 15, color: colors.text },
  viewAll: { fontFamily: type.bodyBold, fontSize: 15, color: colors.accent[700], minHeight: 24 },
});
