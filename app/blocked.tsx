import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import CompactHeader from '../components/CompactHeader';
import ErrorBanner from '../components/ErrorBanner';
import Screen from '../components/Screen';
import { goBack } from '../lib/navigation';
import { fetchMyBlocks, unblockUser, type BlockedPerson } from '../lib/moderation';
import { useSession } from '../lib/session';
import { colors, radius, space, type } from '../lib/theme';

/**
 * Profile → Blocked people: everyone the viewer has blocked, each with
 * Unblock. Unblocking needs no confirmation: it is undone by blocking again.
 */
export default function BlockedScreen() {
  const { session, loading } = useSession();
  const router = useRouter();

  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: failed } = await fetchMyBlocks();
    if (failed) {
      setError(failed);
      setPeople((cur) => cur ?? []);
      return;
    }
    setError(null);
    setPeople(data ?? []);
  }, []);

  useEffect(() => {
    if (!session?.user.id) return;
    void load();
  }, [session?.user.id, load]);

  async function unblock(person: BlockedPerson) {
    if (busyId) return;
    setBusyId(person.id);
    setError(null);
    const { error: failed } = await unblockUser(person.id);
    setBusyId(null);
    if (failed) {
      setError(failed);
      return;
    }
    setPeople((cur) => (cur ?? []).filter((p) => p.id !== person.id));
  }

  const header = (
    <CompactHeader
      divider={false}
      onBack={() => goBack(router, '/profile')}
      backLabel="Back to Profile"
      kind={null}
      titleOnly
      title="Blocked people"
    />
  );

  if (loading) {
    return (
      <Screen header={header} contentStyle={[styles.container, styles.fill]}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen header={header} scroll contentStyle={styles.container}>
      {error ? <ErrorBanner message={error} /> : null}

      {people === null ? (
        <ActivityIndicator color={colors.accentColor} />
      ) : people.length === 0 ? (
        error ? null : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>You haven&apos;t blocked anyone.</Text>
          </View>
        )
      ) : (
        <View style={styles.card}>
          {people.map((p, i) => (
            <View key={p.id} style={[styles.row, i > 0 && styles.divided]}>
              <Text style={styles.name} numberOfLines={1}>
                {p.name}
              </Text>
              <Pressable
                onPress={() => void unblock(p)}
                disabled={busyId !== null}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${p.name}`}
                accessibilityState={{ disabled: busyId !== null, busy: busyId === p.id }}
                style={({ pressed }) => [styles.unblock, pressed && styles.unblockPressed]}
              >
                {busyId === p.id ? (
                  <ActivityIndicator size="small" color={colors.accent[700]} />
                ) : (
                  <Text style={styles.unblockText}>Unblock</Text>
                )}
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: space[3],
    paddingHorizontal: space[6],
    paddingBottom: space[6],
    gap: space[3],
  },
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  card: { backgroundColor: colors.surface, borderRadius: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingLeft: 16, paddingRight: 8 },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  name: { flex: 1, minWidth: 0, fontFamily: type.bodySemiBold, fontSize: 16, color: colors.text },
  unblock: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockPressed: { backgroundColor: colors.accent[100] },
  unblockText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.accent[700] },
});
