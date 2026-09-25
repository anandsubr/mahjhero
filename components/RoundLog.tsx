import { Pressable, StyleSheet, Text, View } from 'react-native';
import { TrashIcon, TrophyIcon } from './icons';
import { colors, radius, type } from '../lib/theme';

export type DisplayRound = {
  id: string;
  winner_profile_id: string;
  winner_name: string;
  points: number;
};

type Props = {
  /** Newest first. */
  rounds: DisplayRound[];
  /** The winner's seat colour, so a row's avatar matches their seat tile.
   *  Optional: defaults to one neutral colour for every row. */
  colorFor?: (profileId: string) => string;
  canDelete: boolean;
  busy?: boolean;
  onDelete: (roundId: string) => void;
};

/**
 * A table's round-by-round log, as the game-screen 2a handoff draws it:
 * "Rounds" with how many have been played, then one row per round, newest
 * first -- the winner's avatar, their name over "Round N", and the trophy
 * with "+points". The latest round's row is tinted.
 *
 * Organizer only: a way to delete a mis-recorded round (the trash control on
 * each row). Read-only otherwise: recording itself happens through the
 * seat's own sheet (SeatGrid/SeatSheet), not here -- see the 2026-09-03
 * game-screen-cleanup spec. Round numbers are derived from position (the
 * oldest round is Round 1); table_rounds stores no round number or
 * duration, so the design's "· 20 min" has nothing to read and is omitted.
 */
export default function RoundLog({
  rounds,
  colorFor,
  canDelete,
  busy = false,
  onDelete,
}: Props) {
  const played = rounds.length;
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>Rounds</Text>
        {played > 0 ? <Text style={styles.meta}>{`${played} played`}</Text> : null}
      </View>
      {played === 0 ? (
        <Text style={styles.help}>No rounds recorded yet.</Text>
      ) : (
        rounds.map((round, index) => {
          const roundNumber = played - index;
          const initial = round.winner_name.trim().charAt(0).toUpperCase() || '?';
          return (
            <View
              key={round.id}
              style={[styles.row, index === 0 ? styles.rowLatest : null]}
            >
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: colorFor?.(round.winner_profile_id) ?? colors.neutral[800] },
                ]}
              >
                <Text style={styles.avatarText}>{initial}</Text>
              </View>
              <View style={styles.rowText}>
                <Text style={styles.winner} numberOfLines={1}>
                  {round.winner_name}
                </Text>
                <Text style={styles.meta}>{`Round ${roundNumber}`}</Text>
              </View>
              <View
                style={styles.points}
                accessible
                accessibilityLabel={`${round.winner_name} won ${round.points} points`}
              >
                <TrophyIcon size={15} color={colors.accent[600]} />
                <Text style={styles.pointsText}>{`+${round.points}`}</Text>
              </View>
              {canDelete ? (
                <Pressable
                  onPress={() => onDelete(round.id)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete ${round.winner_name}'s round for ${round.points} points`}
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.delete,
                    pressed ? styles.deletePressed : null,
                    busy ? styles.dimmed : null,
                  ]}
                >
                  <TrashIcon size={16} color={colors.neutral[700]} />
                </Pressable>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  heading: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  meta: { fontFamily: type.bodyRegular, fontSize: 12, color: colors.neutral[700] },
  help: { fontFamily: type.bodyRegular, fontSize: 14, color: colors.neutral[700] },
  row: {
    minHeight: 52,
    paddingTop: 6,
    paddingRight: 12,
    paddingBottom: 6,
    paddingLeft: 8,
    borderRadius: 14,
    backgroundColor: colors.bg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowLatest: { backgroundColor: colors.accent[100] },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: type.bodyBold, fontSize: 13, color: '#ffffff' },
  rowText: { flex: 1, minWidth: 0 },
  winner: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  points: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pointsText: { fontFamily: type.bodyBold, fontSize: 14, color: colors.accent[700] },
  delete: {
    width: 36,
    height: 36,
    marginRight: -6,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deletePressed: { backgroundColor: colors.neutral[300] },
  dimmed: { opacity: 0.5 },
});
