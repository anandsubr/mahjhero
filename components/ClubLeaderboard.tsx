import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import ErrorBanner from './ErrorBanner';
import { FormCard } from './GameForm';
import { TrophyIcon } from './icons';
import { fetchClubLeaderboard, type LeaderboardEntry } from '../lib/leaderboard';
import { initialsFrom } from '../lib/dashboard';
import { avatarColorFor } from '../lib/friends';
import { colors, radius, space, type } from '../lib/theme';

export type ClubLeaderboardHandle = {
  /** Refetches the entries -- what HubSection's pull-to-refresh calls. */
  reload: () => Promise<void>;
};

type Props = { clubId: string; userId: string | undefined };

/**
 * All-time, points-first ranking -- moved out of app/clubs/[id]/leaderboard.tsx
 * (club-hub phase 2, Task 9) so the Ranks hub section can render the same
 * list the standalone leaderboard screen always has. That old route is now
 * a redirect to `/clubs/${id}/ranks`; the club identity header it used to
 * draw is the hub header above this section now, so only the rows
 * themselves moved here.
 *
 * Same seeded avatar colours as the Friends screen, so a person looks the
 * same on both.
 */
const ClubLeaderboard = forwardRef<ClubLeaderboardHandle, Props>(
  function ClubLeaderboard({ clubId, userId }, ref) {
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const loadingRef = useRef(false);

    const load = async () => {
      if (!clubId || loadingRef.current) return;
      loadingRef.current = true;
      const result = await fetchClubLeaderboard(clubId);
      if (result === null) {
        setFailed(true);
        setReady(true);
        loadingRef.current = false;
        return;
      }
      setFailed(false);
      setEntries(result);
      setReady(true);
      loadingRef.current = false;
    };

    useImperativeHandle(ref, () => ({ reload: load }));

    useEffect(() => {
      void load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clubId]);

    const displayName = (entry: LeaderboardEntry) =>
      entry.display_name.trim().length > 0 ? entry.display_name : 'Member';

    if (!ready) {
      return <ActivityIndicator style={styles.loading} color={colors.accentColor} />;
    }

    return (
      <>
        {failed ? (
          <ErrorBanner message="The leaderboard could not be loaded. Pull to refresh or try again shortly." />
        ) : entries.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <TrophyIcon size={20} color={colors.accent2[800]} />
            </View>
            <Text style={styles.emptyText}>No rounds recorded yet.</Text>
          </View>
        ) : (
          // Clipped so the viewer's tinted row keeps the card's rounded
          // corners when it is the first or last row.
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
                  <View
                    testID="leaderboard-avatar"
                    style={[styles.avatar, { backgroundColor: avatarColorFor(entry.profile_id) }]}
                  >
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
      </>
    );
  },
);

export default ClubLeaderboard;

const styles = StyleSheet.create({
  loading: { marginTop: 24 },
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
