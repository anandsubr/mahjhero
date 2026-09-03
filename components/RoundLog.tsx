import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import { colors, space, type } from '../lib/theme';

export type DisplayRound = {
  id: string;
  winner_profile_id: string;
  winner_name: string;
  points: number;
};

type Props = {
  /** Newest first. */
  rounds: DisplayRound[];
  canDelete: boolean;
  busy?: boolean;
  onDelete: (roundId: string) => void;
};

/**
 * A table's round-by-round log: who won each hand, and -- organizer only --
 * a way to delete a mis-recorded one. Read-only otherwise: recording itself
 * happens through the seat's own tap panel (SeatGrid), not here -- see the
 * 2026-09-03 game-screen-cleanup spec for why. That panel is already scoped
 * to exactly one person, which is exactly what a round winner needs to be,
 * so a second winner-picker here was redundant. Running totals moved to
 * the seat tiles themselves for the same reason this no longer needs
 * `players` at all.
 *
 * Wrapped in its own tinted Card so the section reads as a distinct block
 * against the rest of the table card, not more body text.
 */
export default function RoundLog({ rounds, canDelete, busy = false, onDelete }: Props) {
  return (
    <Card background={colors.accent[100]} style={styles.card}>
      <Text style={styles.heading}>Rounds</Text>
      {rounds.length === 0 ? (
        <Text style={styles.help}>No rounds recorded yet.</Text>
      ) : (
        rounds.map((round) => (
          <View key={round.id} style={styles.row}>
            <Text style={styles.roundText}>
              {round.winner_name} · {round.points} pts
            </Text>
            {canDelete ? (
              <Button
                variant="ghost"
                big={false}
                disabled={busy}
                onPress={() => onDelete(round.id)}
                accessibilityLabel={`Delete ${round.winner_name}'s round for ${round.points} points`}
              >
                Delete
              </Button>
            ) : null}
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
    marginTop: space[3],
  },
  heading: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  roundText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
  },
});
