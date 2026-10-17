import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import ErrorBanner from './ErrorBanner';
import PostCard from './board/PostCard';
import { GENERIC_ERROR } from '../lib/constants';
import { getSignedUrls } from '../lib/attachments';
import {
  fetchClubFeed,
  mergeFeedPages,
  togglePostHeart,
  type FeedPost,
} from '../lib/board';
import { useSession } from '../lib/session';
import { colors, radius, space, type } from '../lib/theme';
import { useThreadRealtime } from '../lib/use-thread-realtime';

export type ClubBoardHandle = {
  /**
   * Refetches the first page of the board -- what
   * HubSection's pull-to-refresh and the pinned composer's `onPosted` call.
   */
  reload: () => Promise<void>;
};

type Props = {
  threadId: string;
};

/** fetch_club_feed's page size. A shorter page means nothing older is left. */
const PAGE_SIZE = 30;
/** fetch_club_feed's server-side cap on p_limit. */
const MAX_REFRESH = 100;

/** Keyset cursor for the post: its created_at (the feed is newest first), plus its id. */
function cursorFor(post: FeedPost): { at: string; id: string } {
  return { at: post.createdAt, id: post.id };
}

/**
 * A club's Board feed (Design V3, club-hub phase 4): caption, then PostCards
 * with hearts and a comments peek, newest post first (no sort control --
 * user decision 2026-10-17), paged 30 at a time with "Show older posts".
 *
 * Mounted by the hub Board section and by app/messages/club/[threadId]; both
 * pin BoardComposer in their own footer (outside the scroller) and call
 * `reload()` from its `onPosted`, which brings the new post to the top.
 * Organizers announce (post + email the club) from that composer's
 * megaphone toggle, not from here.
 *
 * Opening the board does not mark anything read -- the post screen owns
 * `mark_post_read`.
 */
const ClubBoard = forwardRef<ClubBoardHandle, Props>(function ClubBoard(
  { threadId },
  ref,
) {
  const { session } = useSession();
  const router = useRouter();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hearting, setHearting] = useState<ReadonlySet<string>>(new Set());
  const [urls, setUrls] = useState<Record<string, string>>({});

  // Every first-page load bumps this; a response (first page or older page)
  // whose sequence is no longer current is dropped, so a refresh landing
  // mid-request can never be overwritten by the stale answer.
  const seqRef = useRef(0);
  // Synchronous in-flight guards: render state cannot see a second tap
  // landing before the next commit.
  const loadingMoreRef = useRef(false);
  const heartingRef = useRef(new Set<string>());
  // How many posts are loaded, read by `load` without making it depend on
  // `posts` (which would re-run the focus effect on every heart/page).
  const loadedCountRef = useRef(0);
  loadedCountRef.current = posts.length;

  const load = useCallback(async () => {
    if (!threadId) return;
    const seq = ++seqRef.current;
    // A refresh re-reads everything already loaded (up to the server cap),
    // so focus/realtime/pull never collapse older pages back to the first 30.
    const requested = Math.min(Math.max(PAGE_SIZE, loadedCountRef.current), MAX_REFRESH);
    const rows = await fetchClubFeed(threadId, undefined, requested);
    if (seq !== seqRef.current) return;
    // null means "we could not ask", [] means "there is nothing" -- an empty
    // state for a failed read would tell a member something false.
    if (rows === null) {
      setError(GENERIC_ERROR);
      setReady(true);
      return;
    }
    setError(null);
    // Past the cap, the refreshed head goes ahead of the already-loaded
    // tail (de-duped by id, fresh rows win) so nothing older disappears.
    setPosts((cur) => (cur.length > MAX_REFRESH ? mergeFeedPages(rows, cur) : rows));
    // Once older posts were known to exist, a refresh doesn't hide the button.
    setHasMore((had) => had || rows.length >= requested);
    setReady(true);
  }, [threadId]);

  useImperativeHandle(ref, () => ({ reload: load }), [load]);

  // On FOCUS, not only on mount: opening a post pushes a screen on top of
  // this one, and post_reads is not in the realtime publication, so only a
  // refocus can clear an unread dot the member just read.
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
      // Refetch rather than patching the payload row in: author name, role,
      // hearts, comment peek and unread are all computed server-side.
      void load();
    }, [load]),
  );

  const loadOlder = useCallback(async () => {
    if (loadingMoreRef.current || posts.length === 0) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = seqRef.current;
    const page = await fetchClubFeed(threadId, cursorFor(posts[posts.length - 1]));
    loadingMoreRef.current = false;
    setLoadingMore(false);
    if (seq !== seqRef.current) return;
    if (page === null) {
      setError(GENERIC_ERROR);
      return;
    }
    setError(null);
    setPosts((cur) => mergeFeedPages(cur, page));
    setHasMore(page.length >= PAGE_SIZE);
  }, [threadId, posts]);

  const toggleHeart = useCallback(async (postId: string) => {
    if (heartingRef.current.has(postId)) return;
    const before = posts.find((p) => p.id === postId);
    if (!before) return;
    heartingRef.current.add(postId);
    setHearting(new Set(heartingRef.current));
    const prevHearted = before.heartedByMe;
    // Every change is applied to the row as it is NOW, not as it was at tap
    // time: a refresh landing mid-flight may have replaced it with a newer
    // count, and only my own heart's +/-1 is ours to adjust.
    const setMine = (hearted: boolean, onlyIfShowing?: boolean) =>
      setPosts((cur) =>
        cur.map((p) => {
          if (p.id !== postId) return p;
          if (onlyIfShowing !== undefined && p.heartedByMe !== onlyIfShowing) return p;
          if (p.heartedByMe === hearted) return p;
          return {
            ...p,
            heartedByMe: hearted,
            heartCount: Math.max(0, p.heartCount + (hearted ? 1 : -1)),
          };
        }),
      );
    setMine(!prevHearted);
    const { hearted, error: refusal } = await togglePostHeart(postId);
    if (refusal || hearted === null) {
      // Roll back only if the row still shows the optimistic state; a
      // refreshed row already carries the server's truth.
      setMine(prevHearted, !prevHearted);
    } else {
      setMine(hearted);
    }
    heartingRef.current.delete(postId);
    setHearting(new Set(heartingRef.current));
  }, [posts]);

  // Sign every loaded attachment path not yet signed, in one batch per
  // change to the loaded set (getSignedUrls also caches across calls).
  useEffect(() => {
    const missing = Array.from(
      new Set(posts.flatMap((p) => p.attachments.map((a) => a.storage_path))),
    ).filter((path) => !(path in urls));
    if (missing.length === 0) return;
    let cancelled = false;
    void getSignedUrls(missing).then((resolved) => {
      if (cancelled || Object.keys(resolved).length === 0) return;
      setUrls((cur) => ({ ...cur, ...resolved }));
    });
    return () => {
      cancelled = true;
    };
    // `urls` deliberately left out: adding resolved urls must not re-run
    // this for paths that failed to sign.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  const openPost = (postId: string) => router.push(`/messages/club/${threadId}/${postId}`);

  return (
    <>
      <Text style={styles.caption}>Everyone in the club sees posts here</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : posts.length === 0 && !error ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Nothing here yet. Start the first post.</Text>
        </View>
      ) : (
        <View>
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              attachmentUrls={urls}
              onOpen={() => openPost(post.id)}
              onToggleHeart={() => void toggleHeart(post.id)}
              hearting={hearting.has(post.id)}
            />
          ))}
          {hasMore ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show older posts"
              accessibilityState={{ busy: loadingMore }}
              disabled={loadingMore}
              onPress={() => void loadOlder()}
              style={({ pressed }) => [styles.older, pressed && styles.olderPressed]}
            >
              {loadingMore ? (
                <ActivityIndicator color={colors.accentColor} />
              ) : (
                <Text style={styles.olderText}>Show older posts</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      )}
    </>
  );
});

export default ClubBoard;

const styles = StyleSheet.create({
  caption: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    color: colors.neutral[700],
  },
  emptyCard: {
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
    marginTop: space[3],
  },
  emptyText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    lineHeight: 24,
    color: colors.textMuted,
  },
  older: {
    minHeight: 44,
    marginTop: space[3],
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  olderPressed: { backgroundColor: colors.neutral[300] },
  olderText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.accent[700] },
});
