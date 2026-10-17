import { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';
import CompactHeader from '../../../../components/CompactHeader';
import ClubBoard from '../../../../components/ClubBoard';
import Screen from '../../../../components/Screen';
import {
  fetchThread,
  threadKindFor,
  threadTitleFor,
  type ThreadDetail,
} from '../../../../lib/messages';
import { useSession } from '../../../../lib/session';
import { colors, space } from '../../../../lib/theme';

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

  // Kept whole, not trimmed to `club_id`: the header below needs
  // `threadTitleFor`/`threadKindFor`'s full `ThreadDetail` to name the club
  // and pick the avatar kind, and the New-post button's `clubId` is one
  // field of that same row, so there is nothing left to gain from narrowing
  // the state down to a lone column the way this used to.
  const [thread, setThread] = useState<ThreadDetail | null>(null);

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
    <Screen scroll contentStyle={styles.container}>
      {/*
        The compact one-row header (components/CompactHeader.tsx): chevron,
        the club's tile and name, and ⊕ New post on the right. The chevron
        and ⊕ always render -- neither needs `thread` loaded, and the
        board's own load failing must not also take away the one way to
        start a post; the tile and name wait for a loaded thread. `clubId`
        falls back to '' before `thread` resolves: the compose screen still
        works without it, just without an Announcement toggle or recipient
        preview.
      */}
      <CompactHeader
        variant="inset"
        onBack={() => router.push('/messages')}
        backLabel="Back to Messages"
        kind={thread ? kind : null}
        clubId={kind === 'club' ? thread?.club_id : null}
        title={title}
        action={{
          icon: 'plus',
          label: 'New post',
          onPress: () =>
            router.push(
              `/messages/club/new?threadId=${threadId}&clubId=${thread?.club_id ?? ''}`,
            ),
        }}
      />

      {/*
        The board list itself -- components/ClubBoard.tsx, extracted here in
        club-hub phase 2 Task 9 so the Board hub section can render the same
        component. `showNewPost` stays off: this screen's own CompactHeader
        ⊕ above already carries the New-post action, wired to the same
        destination.
      */}
      <ClubBoard threadId={threadId} clubId={thread?.club_id ?? ''} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[3] },
  centered: { alignItems: 'center' },
});
