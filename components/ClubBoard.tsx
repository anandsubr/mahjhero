import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import ErrorBanner from './ErrorBanner';
import PostRow from './messages/PostRow';
import { PlusIcon } from './icons';
import { GENERIC_ERROR } from '../lib/constants';
import { fetchClubPosts, type ClubPost } from '../lib/messages';
import { useSession } from '../lib/session';
import { colors, radius, space, type } from '../lib/theme';
import { useThreadRealtime } from '../lib/use-thread-realtime';

export type ClubBoardHandle = {
  /** Refetches the board's posts -- what HubSection's pull-to-refresh calls. */
  reload: () => Promise<void>;
};

type Props = {
  threadId: string;
  /** The New-post link's `clubId` query param; see `showNewPost` below. */
  clubId: string;
  /**
   * Renders a "New post" pill above the list, ungated -- the same
   * availability the messages screen's CompactHeader ⊕ always had (it never
   * checked role; whoever could open a club's board could post to it).
   * Left off by app/messages/club/[threadId]/index.tsx, whose own header
   * already carries that ⊕ wired to this exact destination; the Board hub
   * section has no header of its own, so it turns this on instead.
   */
  showNewPost?: boolean;
};

/**
 * A club's board: its root posts, most recent activity first --
 * `last_activity_at` is the sort key and `fetch_club_posts` already returns
 * them in that order, so there is nothing to sort here.
 *
 * Moved out of app/messages/club/[threadId]/index.tsx (club-hub phase 2,
 * Task 9) so the Board hub section can render the same list the messages
 * route always has, rather than a second copy of this logic. The messages
 * screen keeps owning the thread fetch and header (title, avatar, back
 * chevron) -- neither of those is specific to the list itself, and the
 * Board section gets its own club identity from the hub header above it.
 *
 * Every post itself opens a separate post screen (Task 11), which is where
 * replying and `mark_post_read` live -- opening the board is not reading
 * what's on it. Marking anything read from here would mean every post's dot
 * goes dark the moment a member glances at the board, which defeats the
 * reason a board of separately-readable posts exists at all.
 */
const ClubBoard = forwardRef<ClubBoardHandle, Props>(function ClubBoard(
  { threadId, clubId, showNewPost = false },
  ref,
) {
  const { session } = useSession();
  const router = useRouter();

  const [posts, setPosts] = useState<ClubPost[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Written synchronously alongside the async call it guards, the same
  // pattern app/messages/index.tsx's `openingRef` and app/messages/
  // [threadId].tsx's `sendingRef` both record: a boolean read from render
  // state is blind to a second call landing before that render commits.
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

  // Exposes a way for HubSection's pull-to-refresh (in the Board section) to
  // trigger the same `load` this component already runs on focus/realtime --
  // the simplest handle that keeps this move verbatim, rather than adding a
  // `refreshKey` prop this component would need its own effect to watch.
  useImperativeHandle(ref, () => ({ reload: load }), [load]);

  /*
   * On FOCUS, not only on mount -- the same call app/messages/index.tsx
   * already makes for the list, and for a sharper reason here. Opening a
   * post pushes a screen ON TOP of this one; the board stays mounted, so a
   * mount-only effect never runs again. `markPostRead` writes post_reads,
   * and post_reads is not in the realtime publication (20260829070000
   * publishes `messages`), so nothing tells this screen the dot it is
   * drawing is stale. Reading a post and pressing back left the dot lit
   * until the app was restarted.
   */
  useFocusEffect(
    useCallback(() => {
      if (!session?.user.id) return;
      void load();
    }, [session?.user.id, load]),
  );

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

  return (
    <>
      {showNewPost ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New post"
          onPress={() =>
            router.push(`/messages/club/new?threadId=${threadId}&clubId=${clubId}`)
          }
          style={({ pressed }) => [styles.newPost, pressed && styles.newPostPressed]}
        >
          <PlusIcon size={18} color="#fff" />
          <Text style={styles.newPostText}>New post</Text>
        </Pressable>
      ) : null}

      {/* The alert role lives inside ErrorBanner now -- see its docstring. */}
      {error ? <ErrorBanner message={error} /> : null}

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
    </>
  );
});

export default ClubBoard;

const styles = StyleSheet.create({
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
  newPost: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    marginBottom: space[3],
  },
  newPostPressed: { backgroundColor: colors.accent[800] },
  newPostText: { fontFamily: type.bodyBold, fontSize: 15, color: '#fff' },
});
