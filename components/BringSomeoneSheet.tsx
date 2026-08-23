import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import Toggle from './Toggle';
import type { BookingOutcome } from '../lib/bookings';
import type { EventTable } from '../lib/events';
import type { ClubMember } from '../lib/clubs';
import { colors, radius, space, type } from '../lib/theme';

type Props = {
  roster: ClubMember[];
  /** profile ids already holding a live booking for this game. */
  booked: string[];
  youId: string;
  tables: EventTable[];
  initialTableId: string | null;
  onPropose: (input: {
    players: string[];
    preferredTableId: string | null;
    allowSplit: boolean;
  }) => Promise<{ plan: BookingOutcome | null; error: string | null }>;
  onCommit: (input: {
    players: string[];
    preferredTableId: string | null;
    allowSplit: boolean;
  }) => Promise<{ result: BookingOutcome | null; error: string | null }>;
  onClose: () => void;
};

/**
 * The only place propose_booking is used.
 *
 * A group can be split across tables, and the parent spec is explicit that
 * the app shows exactly who sits where and asks. A solo booking skips this
 * entirely — there is nothing to show, so the round trip would buy a dialog
 * nobody needs.
 */
export default function BringSomeoneSheet({
  roster,
  booked,
  youId,
  tables,
  initialTableId,
  onPropose,
  onCommit,
  onClose,
}: Props) {
  const [players, setPlayers] = useState<string[]>([youId]);
  const [tableId, setTableId] = useState<string | null>(initialTableId);
  const [allowSplit, setAllowSplit] = useState(true);
  const [plan, setPlan] = useState<BookingOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Anybody already coming is not offered. The database refuses them
  // anyway; not offering them is what stops a member meeting a refusal
  // they had no way to predict.
  const available = roster.filter(
    (m) => m.profile_id !== youId && !booked.includes(m.profile_id),
  );

  const nameOf = (id: string) =>
    id === youId
      ? 'You'
      : (roster.find((m) => m.profile_id === id)?.display_name ?? 'Someone');

  function toggle(id: string) {
    setPlan(null);
    setPlayers((current) =>
      current.includes(id) ? current.filter((p) => p !== id) : [...current, id],
    );
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const { plan: proposed, error: failed } = await onPropose({
      players,
      preferredTableId: tableId,
      allowSplit,
    });
    setBusy(false);
    if (failed || !proposed) {
      setError(failed);
      return;
    }
    // Nothing to show: seat them without a second tap.
    if (proposed.outcome === 'seated' && !proposed.split) {
      await commit(allowSplit);
      return;
    }
    setPlan(proposed);
  }

  async function commit(split: boolean) {
    setBusy(true);
    setError(null);
    const { error: failed } = await onCommit({
      players,
      preferredTableId: tableId,
      allowSplit: split,
    });
    setBusy(false);
    if (failed) {
      setError(failed);
      return;
    }
    onClose();
  }

  return (
    <Card>
      <Text style={styles.heading}>Who's coming?</Text>

      <View style={styles.people}>
        <View style={[styles.person, styles.personOn]}>
          <Text style={styles.personTextOn}>You</Text>
        </View>
        {available.map((member) => {
          const on = players.includes(member.profile_id);
          return (
            <Pressable
              key={member.profile_id}
              style={[styles.person, on && styles.personOn]}
              onPress={() => toggle(member.profile_id)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`${on ? 'Remove' : 'Add'} ${member.display_name}`}
              aria-selected={on}
              aria-disabled={busy}
            >
              <Text style={on ? styles.personTextOn : styles.personText}>
                {member.display_name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.heading}>Where?</Text>
      <View style={styles.people}>
        {tables.map((table) => {
          const on = tableId === table.id;
          return (
            <Pressable
              key={table.id}
              style={[styles.person, on && styles.personOn]}
              onPress={() => {
                setPlan(null);
                setTableId(table.id);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Sit at ${table.label}`}
              aria-selected={on}
              aria-disabled={busy}
            >
              <Text style={on ? styles.personTextOn : styles.personText}>
                {table.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          style={[styles.person, tableId === null && styles.personOn]}
          onPress={() => {
            setPlan(null);
            setTableId(null);
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Any table"
          aria-selected={tableId === null}
          aria-disabled={busy}
        >
          <Text style={tableId === null ? styles.personTextOn : styles.personText}>
            Any table
          </Text>
        </Pressable>
      </View>

      {/*
        Hidden for "any table": nobody in an any-table group is placed, so
        there is nothing to split, and offering the choice would be
        offering one that changes nothing.
      */}
      {tableId !== null ? (
        <Toggle
          value={allowSplit}
          onValueChange={(next) => {
            setPlan(null);
            setAllowSplit(next);
          }}
          accessibilityLabel="Split us up if we can't sit together"
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {plan === null ? (
        <Button block loading={busy} onPress={confirm} accessibilityLabel="Confirm this booking">
          Confirm
        </Button>
      ) : plan.outcome === 'seated' ? (
        <>
          <Text style={styles.heading}>They can't all sit together</Text>
          {plan.placements.map((placement) => (
            <Text key={placement.profile_id} style={styles.placement}>
              {nameOf(placement.profile_id)} → {placement.table_label}
            </Text>
          ))}
          <Button block loading={busy} onPress={() => commit(true)} accessibilityLabel="Book it this way">
            Book it this way
          </Button>
          <Button
            variant="ghost"
            big={false}
            disabled={busy}
            onPress={() => commit(false)}
            accessibilityLabel="Wait together instead"
          >
            Wait together instead
          </Button>
        </>
      ) : (
        <>
          <Text style={styles.placement}>There is no room for all of you right now.</Text>
          <Button block loading={busy} onPress={() => commit(allowSplit)} accessibilityLabel="Wait together">
            Wait together
          </Button>
        </>
      )}

      <Button variant="ghost" big={false} disabled={busy} onPress={onClose} accessibilityLabel="Close">
        Never mind
      </Button>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
    marginTop: space[3],
  },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  person: {
    borderRadius: radius.pill,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    backgroundColor: colors.neutral[300],
  },
  personOn: { backgroundColor: colors.accent2Color },
  personText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  personTextOn: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.neutral[100],
  },
  placement: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[1],
  },
  error: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.accent[700],
    marginTop: space[2],
  },
});
