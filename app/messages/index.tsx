import { useCallback, useRef, useState } from 'react';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import SegmentedControl from '../../components/SegmentedControl';
import TabBar from '../../components/TabBar';
import ThreadRow from '../../components/ThreadRow';
import UnreadBadge from '../../components/UnreadBadge';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  fetchMyThreads,
  openThreadForClub,
  sectionThreads,
  sortThreads,
  type ThreadListRow,
} from '../../lib/messages';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

const SORTS = [
  { key: 'recent', label: 'Recent' },
  { key: 'club', label: 'By club' },
];

/**
 * The `1C messages` artboard, plus the one thing the design does not have:
 * a Recent | By club sort. The artboard's list inherits the dashboard's club
 * scope instead, which works there because the dashboard has chips — and
 * putting a second chip row here alongside a sort would be two organizing
 * controls on one list.
 */
export default function MessagesScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [rows, setRows] = useState<ThreadListRow[] | null>(null);
  const [ready, setReady] = useState(false);
  const [sort, setSort] = useState('recent');
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
   */
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      void load();
    }, [session, load]),
  );

  const open = useCallback(
    async (row: ThreadListRow) => {
      if (openingRef.current) return;
      openingRef.current = true;
      setActionError(null);

      if (row.thread_id) {
        openingRef.current = false;
        router.push(`/messages/${row.thread_id}`);
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
      router.push(`/messages/${id}`);
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

  const list = rows ?? [];
  const sections = sort === 'club' ? sectionThreads(list) : null;
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
        <Text style={styles.heading}>Messages</Text>
        <Button
          big={false}
          accessibilityLabel="New"
          onPress={() => router.push('/messages/new')}
        >
          New
        </Button>
      </View>

      <SegmentedControl options={SORTS} value={sort} onChange={setSort} />

      {error ? <ErrorBanner message={error} /> : null}

      {!ready ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : rows !== null && list.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>
            No conversations yet. Start one with New.
          </Text>
        </View>
      ) : sections ? (
        sections.map((section) => (
          <View key={section.clubId ?? 'people'} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <UnreadBadge count={section.unread} />
            </View>
            {section.rows.map((row) => (
              <ThreadRow
                key={row.thread_id ?? `club:${row.club_id}`}
                row={row}
                onPress={() => void open(row)}
              />
            ))}
          </View>
        ))
      ) : (
        sortThreads(list).map((row) => (
          <ThreadRow
            key={row.thread_id ?? `club:${row.club_id}`}
            row={row}
            onPress={() => void open(row)}
          />
        ))
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
  section: { gap: space[3] },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space[3],
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
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
