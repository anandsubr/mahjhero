import { useCallback, useRef, useState } from 'react';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MahjongTile from '../../components/MahjongTile';
import PlusButton from '../../components/PlusButton';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import TabBar from '../../components/TabBar';
import ThreadRow from '../../components/ThreadRow';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  fetchMyThreads,
  openThreadForClub,
  orderThreadsForList,
  type ThreadListRow,
} from '../../lib/messages';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

/**
 * The `1C messages` artboard, restyled flat -- iOS Messages, not the
 * artboard's `class="card"` rows -- and with the Recent | By club sort this
 * screen used to carry removed entirely. That sort existed to do two jobs:
 * "By club" grouped, "Recent" floated active conversations up. Pinning club
 * threads at the top of the one list (lib/messages.ts's
 * `orderThreadsForList`) does both at once, which is what makes a second
 * organizing control on top of it redundant rather than merely unused.
 */
export default function MessagesScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [rows, setRows] = useState<ThreadListRow[] | null>(null);
  const [ready, setReady] = useState(false);
  // Split from `actionError` below, the same way clubs/index.tsx keeps
  // `loadFailed` apart from `actionError` — a background refetch that lands
  // while a thread is opening must not clear the refusal that tap just
  // produced, and a fresh refusal must not blank a standing "could not
  // reach MahjHero" either. One shared slot let either overwrite the other.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  // `opening` above is read from the render closure, so a guard written as
  // `if (opening) return` is blind to a tap landing in the same tick as an
  // earlier `setOpening(true)` — a queued tap, a screen-reader activation, a
  // native double-tap — since the closure still holds the old value in that
  // window. This ref is written synchronously alongside `setOpening`, so it
  // is what actually makes the guard sound; `opening` itself keeps doing its
  // own job of re-rendering the row into its disabled/busy look. See the
  // identical comment on `busyRef` in app/clubs/index.tsx and app/friends.tsx
  // for the same bug class.
  const openingRef = useRef(false);

  const load = useCallback(async () => {
    const next = await fetchMyThreads();
    setRows(next);
    // `null` is "we could not ask" and `[]` is "you have no conversations".
    // Showing the empty state for a failed read tells the member something
    // false about themselves.
    setLoadError(next === null ? GENERIC_ERROR : null);
    setReady(true);
  }, []);

  /*
   * Refetch on focus rather than only on mount. Ordinary messages never
   * email, so this list and its badges are the whole notification surface —
   * coming back to the tab has to be enough to see something new. Realtime
   * is deliberately confined to the open thread; see app/messages/[threadId].
   *
   * Keyed on the viewer's id, not the `session` OBJECT: lib/session.tsx hands
   * out a fresh `Session` on every onAuthStateChange, TOKEN_REFRESHED
   * included — hourly, and on web tab focus — and none of that changes who is
   * asking. `load` is already stable.
   */
  useFocusEffect(
    useCallback(() => {
      if (!session?.user.id) return;
      void load();
    }, [session?.user.id, load]),
  );

  const open = useCallback(
    async (row: ThreadListRow) => {
      if (openingRef.current) return;
      openingRef.current = true;
      setActionError(null);

      if (row.thread_id) {
        openingRef.current = false;
        // A club thread lands on its board now; every other kind still
        // opens straight into the flat thread screen.
        router.push(
          row.kind === 'club'
            ? `/messages/club/${row.thread_id}`
            : `/messages/${row.thread_id}`,
        );
        return;
      }

      // A club thread nobody has posted in is listed without an id. Every
      // club row could go through this call; only the ones with no row must.
      if (!row.club_id) {
        openingRef.current = false;
        return;
      }
      setOpening(true);
      const { id, error: refusal } = await openThreadForClub(row.club_id);
      openingRef.current = false;
      setOpening(false);
      if (refusal || !id) {
        setActionError(refusal ?? GENERIC_ERROR);
        return;
      }
      // This branch is only ever reached for a club row (the `!row.club_id`
      // guard above returns for anything else), so the id it just opened
      // always belongs to a club thread -- always the board.
      router.push(`/messages/club/${id}`);
    },
    [router],
  );

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="messages" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  const ordered = orderThreadsForList(rows ?? []);
  // actionError first: it names what the member just tapped, which is more
  // useful in the moment than a standing load failure.
  const error = actionError ?? loadError;

  return (
    <Screen
      scroll
      contentStyle={styles.container}
      tabBar={<TabBar active="messages" />}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View testID="section-tile">
            <MahjongTile suit="bamboo" size="section" />
          </View>
          <Text style={styles.heading}>Messages</Text>
        </View>
        <PlusButton
          onPress={() => router.push('/messages/new')}
          accessibilityLabel="New message"
        />
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : rows !== null && ordered.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No conversations yet. Start one with the + above.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {ordered.map((row, index) => (
            <ThreadRow
              key={row.thread_id ?? `club:${row.club_id}`}
              row={row}
              onPress={() => void open(row)}
              showDivider={index < ordered.length - 1}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  // No gap: components/ThreadRow.tsx's own hairline divider is what
  // separates rows now, not space between cards.
  list: {},
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
