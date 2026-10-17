import { useCallback, useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';
import CompactHeader from '../../../../components/CompactHeader';
import ClubBoard, { type ClubBoardHandle } from '../../../../components/ClubBoard';
import Screen from '../../../../components/Screen';
import BoardComposer from '../../../../components/board/BoardComposer';
import { canAnnounce, fetchRoster } from '../../../../lib/clubs';
import {
  fetchThread,
  threadKindFor,
  threadTitleFor,
  type ThreadDetail,
} from '../../../../lib/messages';
import { useSession } from '../../../../lib/session';
import { colors, space } from '../../../../lib/theme';

/**
 * A club's board: the same Board feed (components/ClubBoard.tsx) the club
 * hub's Board section renders, with the composer pinned at the bottom.
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
 * rather than a list with nothing naming which
 * club it belongs to.
 */
export default function ClubBoardScreen() {
  const { session, loading } = useSession();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();

  // Kept whole, not trimmed to `club_id`: the header below needs
  // `threadTitleFor`/`threadKindFor`'s full `ThreadDetail` to name the club
  // and pick the avatar kind, and the composer's `clubId` is one field of
  // that same row.
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  // Whether the viewer may post announcements (the composer's megaphone
  // toggle) -- roster row -> canAnnounce, once the thread names its club.
  // False until then, and on any failure.
  const [mayAnnounce, setMayAnnounce] = useState(false);
  const boardRef = useRef<ClubBoardHandle>(null);
  const onPosted = useCallback(() => {
    void boardRef.current?.reload();
  }, []);

  useEffect(() => {
    if (!session?.user.id || !threadId) return;
    let cancelled = false;
    // A best-effort read, kept separate from `load()`'s own `loadingRef`
    // guard: this must run once per thread, not on every realtime refetch
    // `load()` also answers, and a failure here must not blank the board
    // the way a failed feed load (lib/board.ts) does -- the posts are the thing
    // this screen exists to show. `thread` staying null on a failure (or
    // while still in flight) degrades the same way in both places that
    // read it below: the composer gets no `clubId` (and no megaphone, since
    // `mayAnnounce` waits on it), and the header renders its chevron alone, with no half-built avatar
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

  const clubId = thread?.club_id ?? null;
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId || !clubId) return;
    let cancelled = false;
    void fetchRoster(clubId).then((roster) => {
      if (cancelled) return;
      const me = roster?.find((m) => m.profile_id === userId);
      setMayAnnounce(me ? canAnnounce(me.role) : false);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, clubId]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
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
    <Screen
      scroll
      avoidKeyboard
      contentStyle={styles.container}
      footer={
        threadId ? (
          <BoardComposer
            threadId={threadId}
            onPosted={onPosted}
            clubId={clubId ?? undefined}
            canAnnounce={mayAnnounce}
          />
        ) : undefined
      }
    >
      {/*
        The compact one-row header (components/CompactHeader.tsx): chevron,
        then the club's tile and name once `thread` loads. No right-hand
        action: posting (and, for organizers, announcing) happens in the
        pinned composer, so the old ⊕ New post screen is gone.
      */}
      <CompactHeader
        variant="inset"
        onBack={() => {
          // The board lives inside the club (hub Board section): with no
          // history (deep link, cold reload) land there, not on the inbox.
          if (router.canGoBack()) router.back();
          // Unloaded thread: the route carries no club id and the inbox no
          // longer lists boards, so '/home' is the only safe landing.
          else router.replace(thread?.club_id ? `/clubs/${thread.club_id}/board` : '/home');
        }}
        backLabel="Back"
        kind={thread ? kind : null}
        clubId={kind === 'club' ? thread?.club_id : null}
        title={title}
      />

      {/*
        The board feed itself -- components/ClubBoard.tsx, shared with the
        hub Board section. The composer is pinned in Screen's footer; a
        successful post reloads the feed so the new post shows first.
      */}
      <ClubBoard ref={boardRef} threadId={threadId} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
});
