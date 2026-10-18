import { useCallback, useState } from 'react';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import CompactHeader from '../../components/CompactHeader';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import ThreadRow from '../../components/ThreadRow';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  fetchMyThreads,
  sortThreads,
  type ThreadListRow,
} from '../../lib/messages';
import { goBack } from '../../lib/navigation';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

/**
 * The personal inbox: one-to-one and group chats only, newest first. Club
 * boards and game chats open from their club's Board and the game page.
 */
export default function MessagesScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [rows, setRows] = useState<ThreadListRow[] | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  // Reached from Home; a deep link or reload has nothing to pop. The + is
  // the header's one action, as on the club and thread headers.
  const header = (
    <CompactHeader
      variant="inset"
      divider={false}
      onBack={() => goBack(router, '/home')}
      backLabel="Back to Home"
      kind={null}
      titleOnly
      title="Messages"
      action={{
        icon: 'plus',
        label: 'New message',
        onPress: () => router.push('/messages/new'),
      }}
    />
  );

  if (loading) {
    return (
      <Screen contentStyle={[styles.container, styles.fill]}>
        {header}
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  // Club boards and game chats are opened from their club; this inbox is
  // one-to-one and group chats only.
  const ordered = sortThreads(
    (rows ?? []).filter((r) => r.kind === 'direct' || r.kind === 'group'),
  );
  const error = loadError;

  return (
    <Screen scroll contentStyle={styles.container}>
      {header}

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
              key={row.thread_id}
              row={row}
              onPress={() => router.push(`/messages/${row.thread_id}`)}
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
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
