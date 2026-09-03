import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import TextField from './TextField';
import { roundTotals } from '../lib/rounds';
import { colors, radius, space, type } from '../lib/theme';

export type DisplayRound = {
  id: string;
  winner_profile_id: string;
  winner_name: string;
  points: number;
};

export type RoundPlayer = { profileId: string; name: string };

type Props = {
  /** Newest first. */
  rounds: DisplayRound[];
  /** This table's currently confirmed occupants -- the winner pool. */
  players: RoundPlayer[];
  canRecord: boolean;
  canDelete: boolean;
  busy?: boolean;
  onRecord: (winnerProfileId: string, points: number) => void;
  onDelete: (roundId: string) => void;
};

/**
 * A table's round-by-round log: who won each hand, a running total per
 * player, and -- gated separately, per the spec's "both roles can record,
 * organizer only deletes" split -- the record form and delete affordances.
 *
 * Totals are computed here from `rounds` via `roundTotals`
 * (lib/rounds.ts), not stored: a derived sum cannot drift from the rows it
 * sums, the same call `booking_groups` made dropping a stored `size`.
 *
 * The record form's own `selectedWinner`/`pointsText` are local state,
 * cleared immediately after calling `onRecord` -- optimistic, not waiting
 * for the parent's reload, the same shape the event screen's own
 * `pendingTier`/`waitlistNote` already use for other in-flight forms.
 */
export default function RoundLog({
  rounds,
  players,
  canRecord,
  canDelete,
  busy = false,
  onRecord,
  onDelete,
}: Props) {
  const [selectedWinner, setSelectedWinner] = useState<string | null>(null);
  const [pointsText, setPointsText] = useState('');

  const totals = roundTotals(rounds);
  // Names come from `rounds` itself (each DisplayRound already carries the
  // roster's `winner_name`), not from `players` -- `players` is TableCard's
  // currently-seated occupants, which rewrites the viewer's own name to
  // "You" and drops anyone who has since left the table. Reading from the
  // same source as the round rows below means the totals line and the rows
  // can never disagree, and a departed winner's total still shows their
  // real name instead of "?".
  const namesByPlayer = new Map(rounds.map((r) => [r.winner_profile_id, r.winner_name]));
  const playerOrder = new Map(players.map((p, i) => [p.profileId, i]));
  const sortedTotals = totals.sort((a, b) => {
    const aIndex = playerOrder.get(a.profileId) ?? Infinity;
    const bIndex = playerOrder.get(b.profileId) ?? Infinity;
    return aIndex - bIndex;
  });
  const totalsLine = sortedTotals
    .map((t) => `${namesByPlayer.get(t.profileId) ?? '?'}: ${t.points}`)
    .join(' · ');

  const parsedPoints = Number.parseInt(pointsText, 10);
  const validPoints = Number.isInteger(parsedPoints) && parsedPoints > 0;
  const canSubmit = canRecord && selectedWinner !== null && validPoints && !busy;

  function submit() {
    if (!canSubmit || selectedWinner === null) return;
    onRecord(selectedWinner, parsedPoints);
    setSelectedWinner(null);
    setPointsText('');
  }

  return (
    <View style={styles.wrap}>
      {totals.length > 0 ? <Text style={styles.totals}>{totalsLine}</Text> : null}

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

      {canRecord ? (
        <View style={styles.form}>
          <Text style={styles.formLabel}>Record a round</Text>
          {players.length === 0 ? (
            // A table nobody is seated at yet has no winner pool -- the
            // server would refuse every winner as "not seated at this
            // table" anyway. Naming this explicitly (spec's Risks #2)
            // keeps an empty table from reading as the feature being
            // broken.
            <Text style={styles.help}>Seat players before recording a round.</Text>
          ) : (
            <>
              <View style={styles.pickerRow}>
                {players.map((player) => {
                  const selected = player.profileId === selectedWinner;
                  return (
                    <Pressable
                      key={player.profileId}
                      onPress={() => setSelectedWinner(player.profileId)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel={`Winner: ${player.name}`}
                      aria-selected={selected}
                      aria-disabled={busy}
                      style={[
                        styles.pill,
                        selected ? styles.pillSelected : styles.pillUnselected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          selected ? styles.pillTextSelected : null,
                        ]}
                      >
                        {player.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextField
                label="Points"
                value={pointsText}
                onChangeText={setPointsText}
                keyboardType="number-pad"
                editable={!busy}
              />
              <Button
                disabled={!canSubmit}
                onPress={submit}
                accessibilityLabel="Record a round"
              >
                Record a round
              </Button>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[2],
    marginTop: space[3],
  },
  totals: {
    fontFamily: type.bodySemiBold,
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
  form: {
    gap: space[2],
    marginTop: space[2],
  },
  formLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  pill: {
    borderRadius: radius.pill,
    minHeight: 44,
    paddingHorizontal: space[4],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  pillSelected: {
    backgroundColor: colors.accentColor,
    borderColor: 'transparent',
  },
  pillUnselected: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
  },
  pillText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  pillTextSelected: {
    color: colors.bg,
  },
});
