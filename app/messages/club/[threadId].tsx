import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import ErrorBanner from '../../../components/ErrorBanner';
import PostRow from '../../../components/messages/PostRow';
import Screen from '../../../components/Screen';
import TabBar from '../../../components/TabBar';
import { GENERIC_ERROR } from '../../../lib/constants';
import { fetchClubPosts, type ClubPost } from '../../../lib/messages';
import { useSession } from '../../../lib/session';
import { colors, radius, space, type } from '../../../lib/theme';
import { useThreadRealtime } from '../../../lib/use-thread-realtime';

/**
 * A club's board: its root posts, most recent activity first --
 * `last_activity_at` is the sort key and `fetch_club_posts` already returns
 * them in that order, so there is nothing to sort here.
 *
 * Reached from the Messages list, which keeps its one club row; tapping it
 * lands here instead of the flat thread screen now. Every post itself opens
 * a separate post screen (Task 11), which is where replying and
 * `mark_post_read` live -- opening the board is not reading what's on it.
 * Marking anything read from here would mean every post's dot goes dark the
 * moment a member glances at the board, which defeats the reason a board of
 * separately-readable posts exists at all.
 */
export default function ClubBoardScreen() {
  const { session, loading } = useSession();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();

  const [posts, setPosts] = useState<ClubPost[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Written synchronously alongside the async call it guards, the same
  // pattern app/messages/index.tsx's `openingRef` and app/messages/
  // [threadId].tsx's `sendingRef` both record: a boolean read from render
  // state is blind to a second call landing before that render commits.
  // Cleared on every exit path below, including the one where `threadId`
  // never even arrives.
  const loadingRef = useRef(false);

  const load = useCallback(async () => {
    if (!threadId || loadingRef.current) return;
    loadingRef.current = true;
    const rows = await fetchClubPosts(threadId);
    // `fetchClubPosts` never rejects: null means "we could not ask", []
    // means "there is nothing". Showing the empty state for a failed read
    // tells a member something false about their club's board.
    if (rows === null) {
      setError(GENERIC_ERROR);
      setReady(true);
      loadingRef.current = false;
      return;
    }
    setError(null);
    setPosts(rows);
    setReady(true);
    loadingRef.current = false;
  }, [threadId]);

  useEffect(() => {
    if (!session) return;
    void load();
  }, [session, load]);

  useThreadRealtime(
    threadId,
    session?.user.id,
    useCallback(() => {
      // Refetch rather than appending the payload row: a `postgres_changes`
      // INSERT carries author_id but not the joined author_name, and the
      // board's reply_count/last_activity_at/unread columns are all
      // computed server-side -- there is nothing here to patch a payload
      // row into that wouldn't already need the full row back anyway.
      void load();
    }, [load]),
  );

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="messages" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="messages" />}>
      {error ? (
        // No native `role="alert"` equivalent on ErrorBanner itself (it is
        // shared by a dozen screens that don't need one) -- wrapping it here
        // is what actually gets a member using a screen reader told a load
        // failed without them having to find and read the banner's text.
        <View accessibilityRole="alert">
          <ErrorBanner message={error} />
        </View>
      ) : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : posts.length === 0 && !error ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            Nothing here yet. Start the first post.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {posts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              onPress={() => router.push(`/messages/club/${threadId}/${post.id}`)}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  list: { gap: space[3] },
  // The same dashed-border empty card app/messages/index.tsx and
  // app/messages/[threadId].tsx already use, reused rather than a third
  // near-identical pair of styles.
  emptyCard: {
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
  },
  emptyText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
});
