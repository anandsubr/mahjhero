import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../components/Button';
import Card from '../../../components/Card';
import DashboardHeader from '../../../components/DashboardHeader';
import ErrorBanner from '../../../components/ErrorBanner';
import Screen from '../../../components/Screen';
import TabBar from '../../../components/TabBar';
import { ChevronLeftIcon } from '../../../components/icons';
import { fetchClub } from '../../../lib/clubs';
import type { Club } from '../../../lib/clubs';
import { GENERIC_ERROR } from '../../../lib/constants';
import {
  fetchClubLeaderboard,
  type LeaderboardEntry,
} from '../../../lib/leaderboard';
import { useSession } from '../../../lib/session';
import { colors, space, type } from '../../../lib/theme';

/**
 * All-time, points-first ranking, built on app/clubs/[id]/venues.tsx's own
 * template (same guard order, same back button, same flat DashboardHeader
 * shape) rather than a new screen shape. `entriesFailed` is kept separate
 * from `loadFailed` the same way venues.tsx keeps `venuesFailed` apart from
 * its own club/roster load -- a failed leaderboard read is not "no rounds
 * recorded" (the empty-state copy would be a false statement), and must not
 * blank a screen whose club name loaded just fine.
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

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      {/* Generic label, not club.name: the kicker right below already names
          the club, so repeating it here would read as a mistake rather than
          confirmation. Matches venues.tsx. */}
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push(`/clubs/${clubId}`)}
        accessibilityLabel="Back to the club"
        style={styles.backButton}
      >
        Club
      </Button>

      <DashboardHeader kicker={club.name} name="Leaderboard" meta="" />

      {entriesFailed ? (
        <ErrorBanner message="The leaderboard could not be loaded. Pull to refresh or try again shortly." />
      ) : entries.length === 0 ? (
        <Text style={styles.help}>No rounds recorded yet.</Text>
      ) : (
        entries.map((entry, index) => (
          <Card key={entry.profile_id}>
            <View style={styles.row}>
              <Text style={styles.rank}>{index + 1}</Text>
              <Text style={styles.name} numberOfLines={1}>
                {entry.display_name.trim().length > 0
                  ? entry.display_name
                  : 'Member'}
              </Text>
              <Text style={styles.points}>{entry.total_points} pts</Text>
            </View>
            <Text style={styles.roundsWon}>
              {entry.rounds_won} {entry.rounds_won === 1 ? 'round' : 'rounds'} won
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  rank: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.textMuted,
    minWidth: 24,
  },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
    flex: 1,
    minWidth: 0,
  },
  points: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  roundsWon: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
    textAlign: 'right',
  },
});
