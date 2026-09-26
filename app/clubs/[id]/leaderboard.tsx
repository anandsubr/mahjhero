import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import CompactHeader from '../../../components/CompactHeader';
import ErrorBanner from '../../../components/ErrorBanner';
import { FormCard, FormTitle } from '../../../components/GameForm';
import Screen from '../../../components/Screen';
import TabBar from '../../../components/TabBar';
import { fetchClub } from '../../../lib/clubs';
import type { Club } from '../../../lib/clubs';
import { GENERIC_ERROR } from '../../../lib/constants';
import {
  fetchClubLeaderboard,
  type LeaderboardEntry,
} from '../../../lib/leaderboard';
import { initialsFrom } from '../../../lib/dashboard';
import { avatarColorFor } from '../../../lib/friends';
import { useSession } from '../../../lib/session';
import { colors, radius, space, type } from '../../../lib/theme';
import { TrophyIcon } from '../../../components/icons';

/**
 * All-time, points-first ranking, built on app/clubs/[id]/venues.tsx's own
 * template for guard order and load-failure handling. Styled after the
 * redesigned screens: the game screen's compact club header (back chevron,
 * the club's tile and name), a left-aligned Caprasimo "Leaderboard" title,
 * and one surface card of divider rows in the Friends screen's shape --
 * same seeded avatar colours, so a person looks the same on both.
 *
 * `entriesFailed` is kept separate from `loadFailed` the same way
 * venues.tsx keeps `venuesFailed` apart from its own club/roster load -- a
 * failed leaderboard read is not "no rounds recorded" (the empty-state copy
 * would be a false statement), and must not blank a screen whose club name
 * loaded just fine.
 */
export default function LeaderboardScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [entriesFailed, setEntriesFailed] = useState(false);

  useEffect(() => {
    if (!userId || !clubId) return;
    let cancelled = false;
    fetchClub(clubId).then((c) => {
      if (cancelled) return;
      if (c === null) setLoadFailed(true);
      else setClub(c);
      setReady(true);
    });
    fetchClubLeaderboard(clubId).then((result) => {
      if (cancelled) return;
      if (result === null) setEntriesFailed(true);
      else setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, clubId]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  // Checked before `!ready`, deliberately: `ready` only ever becomes true
  // inside the effect above, which returns immediately with no session, so
  // a signed-out visitor could never reach it -- the same guard-ordering
  // fix already applied on every other screen in this app.
  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (loadFailed || !club) {
    return (
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  const displayName = (entry: LeaderboardEntry) =>
    entry.display_name.trim().length > 0 ? entry.display_name : 'Member';

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      <CompactHeader
        variant="inset"
        divider={false}
        onBack={() => router.push(`/clubs/${clubId}`)}
        backLabel="Back to the club"
        kind="club"
        clubId={clubId}
        title={club.name}
      />

      <FormTitle>Leaderboard</FormTitle>

      {entriesFailed ? (
        <ErrorBanner message="The leaderboard could not be loaded. Pull to refresh or try again shortly." />
      ) : entries.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <TrophyIcon size={20} color={colors.accent2[800]} />
          </View>
          <Text style={styles.emptyText}>No rounds recorded yet.</Text>
        </View>
      ) : (
        // Clipped so the viewer's tinted row keeps the card's rounded corners
        // when it is the first or last row.
        <FormCard style={styles.list}>
          {entries.map((entry, index) => {
            const isMe = entry.profile_id === userId;
            const podium = index < 3;
            const name = displayName(entry);
            return (
              <View
                key={entry.profile_id}
                style={[styles.row, isMe && styles.rowMine]}
                testID={isMe ? 'leaderboard-row-mine' : undefined}
              >
                <View style={[styles.rank, podium && styles.rankPodium]}>
                  {index === 0 ? <TrophyIcon size={12} color="#ffffff" /> : null}
                  <Text style={[styles.rankText, podium && styles.rankTextPodium]}>
                    {index + 1}
                  </Text>
                </View>
                <View style={[styles.avatar, { backgroundColor: avatarColorFor(entry.profile_id) }]}>
                  <Text style={styles.avatarText}>{initialsFrom(name)}</Text>
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.name} numberOfLines={1}>
                    {isMe ? `${name} (you)` : name}
                  </Text>
                  <Text style={styles.meta}>
                    {entry.rounds_won} {entry.rounds_won === 1 ? 'round' : 'rounds'} won
                  </Text>
                </View>
                <Text style={styles.points}>{entry.total_points} pts</Text>
              </View>
            );
          })}
        </FormCard>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 6, paddingHorizontal: 16, paddingBottom: 28, gap: 18 },
  centered: { alignItems: 'center' },
  list: { overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 16,
  },
  rowMine: { backgroundColor: colors.accent[100] },
  rank: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minWidth: 32,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
  },
  rankPodium: { backgroundColor: colors.accent[700] },
  rankText: { fontFamily: type.bodyBold, fontSize: 14, color: colors.neutral[700] },
  rankTextPodium: { color: '#ffffff' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: type.bodyBold, fontSize: 15, color: '#ffffff' },
  rowBody: { flex: 1, minWidth: 0 },
  name: { fontFamily: type.bodySemiBold, fontSize: 15, color: colors.text },
  meta: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  points: { fontFamily: type.heading, fontSize: 20, color: colors.text },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: space[4],
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent2[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.neutral[700],
  },
});
