import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import ErrorBanner from '../../../../components/ErrorBanner';
import PostRow from '../../../../components/messages/PostRow';
import PlusButton from '../../../../components/PlusButton';
import Screen from '../../../../components/Screen';
import TabBar from '../../../../components/TabBar';
import ThreadAvatar from '../../../../components/ThreadAvatar';
import { ChevronLeftIcon } from '../../../../components/icons';
import { GENERIC_ERROR } from '../../../../lib/constants';
import {
  fetchClubPosts,
  fetchThread,
  threadKindFor,
  threadTitleFor,
  type ClubPost,
  type ThreadDetail,
} from '../../../../lib/messages';
import { useSession } from '../../../../lib/session';
import { colors, radius, space, type } from '../../../../lib/theme';
import { useThreadRealtime } from '../../../../lib/use-thread-realtime';

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
 *
 * Carries the same iOS-Messages header app/messages/[threadId].tsx built --
 * back chevron top-left, avatar and name pill centred beneath it -- so a
 * board reads as the same app as the flat screen it replaced for a club,
 * rather than a bare "New post" button and a list with nothing naming which
 * club it belongs to.
 */
export default function ClubBoardScreen() {
  const { session, loading } = useSession();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();

  const [posts, setPosts] = useState<ClubPost[]>([]);
  // Kept whole, not trimmed to `club_id`: the header below needs
  // `threadTitleFor`/`threadKindFor`'s full `ThreadDetail` to name the club
  // and pick the avatar kind, and the New-post button's `clubId` is one
  // field of that same row, so there is nothing left to gain from narrowing
  // the state down to a lone column the way this used to.
  const [thread, setThread] = useState<ThreadDetail | null>(null);
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

  /*
   * On FOCUS, not only on mount -- the same call app/messages/index.tsx
   * already makes for the list, and for a sharper reason here. Opening a
   * post pushes a screen ON TOP of this one; the board stays mounted, so a
   * mount-only effect never runs again. `markPostRead` writes post_reads,
   * and post_reads is not in the realtime publication (20260829070000
   * publishes `messages`), so nothing tells this screen the dot it is
   * drawing is stale. Reading a post and pressing back left the dot lit
   * until the app was restarted.
   *
   * The callback must be a stable `useCallback`: useFocusEffect keys a
   * useEffect on the callback's identity, so a fresh function each render is
   * a refetch loop. `load` is already stable on `threadId`, and the viewer's
   * id -- not the `session` OBJECT, which lib/session.tsx replaces on every
   * token refresh -- is what this actually depends on. The comment eight
   * lines below said so; this effect was not doing it.
   */
  useFocusEffect(
    useCallback(() => {
      if (!session?.user.id) return;
      void load();
    }, [session?.user.id, load]),
  );

  useEffect(() => {
    if (!session?.user.id || !threadId) return;
    let cancelled = false;
    // A best-effort read, kept separate from `load()`'s own `loadingRef`
    // guard: this must run once per thread, not on every realtime refetch
    // `load()` also answers, and a failure here must not blank the board
    // the way a failed `fetchClubPosts` does -- the posts are the thing
    // this screen exists to show. `thread` staying null on a failure (or
    // while still in flight) degrades the same way in both places that
    // read it below: the New-post link falls back to an empty `clubId`,
    // and the header renders its chevron alone, with no half-built avatar
    // or pill guessing at a name it does not have.
    void fetchThread(threadId).then((detail) => {
      if (!cancelled) setThread(detail);
    });
    return () => {
      cancelled = true;
    };
    // Keyed on the viewer's id, not the `session` object -- see
    // lib/session.tsx's docstring: a token refresh hands out a fresh
    // `Session` that changes nothing about who is asking.
  }, [session?.user.id, threadId]);

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

  const viewerId = session.user.id;
  const title = thread ? threadTitleFor(thread, viewerId) : '';
  // Always 'club' in practice -- this screen only ever opens a club's own
  // board -- but derived through the same helper the flat screen's header
  // uses rather than hard-coded, so a stray game/group thread that somehow
  // reached this route renders its header honestly instead of mislabelled.
  const kind = thread ? threadKindFor(thread, viewerId) : null;

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="messages" />}>
      {/*
        The same iOS Messages header app/messages/[threadId].tsx built:
        a compact back chevron top-left, the club's avatar centred beneath
        it, and its name in a rounded pill under that. The chevron always
        renders (it doesn't need `thread` to navigate away); the avatar and
        pill wait for a loaded thread, the same gate the flat screen's own
        header uses -- there is no partial state where a pill shows without
        a name to put in it.
      */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.push('/messages')}
          accessibilityRole="button"
          accessibilityLabel="Back to Messages"
          style={styles.backButton}
        >
          <ChevronLeftIcon color={colors.text} size={22} />
        </Pressable>

        {/*
          Top-right, symmetric with the back chevron's own absolute
          top-left placement -- the same fixed-size-control-in-one-corner
          idea components/DashboardHeader.tsx's clubTopRow uses via flex-row
          instead. Deliberately not gated on `thread`/`ready` the way the
          centred avatar+pill below is: a member composing does not need
          the existing posts (or even the thread's own name) loaded first,
          and the board's own load failing must not also take away the one
          way to start a post. `clubId` falls back to '' when `thread`
          hasn't resolved yet (or failed) -- the compose screen still works
          without it, just without an Announcement toggle or recipient
          preview to show a plain member who couldn't see either anyway.
          Replaces the old full-width "New post" Button that used to sit
          between this header and the post list.
        */}
        <View style={styles.newPostButton}>
          <PlusButton
            onPress={() =>
              router.push(
                `/messages/club/new?threadId=${threadId}&clubId=${thread?.club_id ?? ''}`,
              )
            }
            accessibilityLabel="New post"
          />
        </View>

        {thread && kind ? (
          <View style={styles.headerCenter}>
            <ThreadAvatar
              kind={kind}
              name={title}
              size={72}
              testID={`thread-header-avatar-${kind}`}
              asTile={kind === 'club'}
              clubId={kind === 'club' ? (thread.club_id ?? undefined) : undefined}
            />

            {/*
              A plain View, not a Pressable -- there is nowhere useful left
              for a tap here to go (matching app/messages/club/new.tsx's own
              inert pill, and its docstring's reasoning: no button role, no
              chevron).
            */}
            <View style={styles.namePill}>
              <Text numberOfLines={1} style={styles.namePillText}>
                {title}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
  // Copied from app/messages/[threadId].tsx's own `header`: back chevron
  // pinned top-left via absolute positioning against this `relative`
  // container, avatar + name pill centred beneath it. Absolute positioning
  // (rather than a mirrored spacer View the same width as the chevron)
  // keeps the centred column exactly centred on the screen's own width
  // regardless of the chevron's size.
  header: {
    position: 'relative',
    alignItems: 'center',
    paddingBottom: space[2],
  },
  // 44x44: below this screen's usual 58px "big" targets (this is a compact
  // header control, not a primary action), but still at the common minimum
  // touch-target size rather than a bare icon-sized hit area.
  backButton: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Mirrors `backButton`'s own top-left absolute placement -- PlusButton is
  // already a fixed 50x50-ish circle (components/PlusButton.tsx), so there
  // is no matching width/height pair to set here the way `backButton` needs
  // for its bare-icon hit area.
  newPostButton: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  headerCenter: { alignItems: 'center', gap: space[2] },
  // colors.surface, the same pill/panel ground the flat screen's own
  // `namePill` reuses -- not a fresh token. Capped so `namePillText`'s
  // `numberOfLines={1}` has a width to actually truncate against for a
  // long club name.
  namePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    maxWidth: 240,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
  },
  // colors.text on colors.surface reads 12.40:1 -- comfortably past AA's
  // 4.5:1 for this 16px text, the same pairing app/messages/[threadId].tsx's
  // own `namePillText` already uses on this exact ground.
  namePillText: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
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
