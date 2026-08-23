import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import type { SeatOccupant } from '../lib/bookings';
import type { EventTable } from '../lib/events';
import { colors, space, type } from '../lib/theme';

type Props = {
  /** Everybody seated at THIS table. */
  occupants: SeatOccupant[];
  tables: EventTable[];
  table: EventTable;
  busy?: boolean;
  canCallForAFourth: boolean;
  onPlace: (bookingId: string, tableId: string | null) => void;
  onRemove: (bookingId: string) => void;
  onCallForAFourth: (tableId: string) => void;
};

/**
 * The organizer's controls for one table: move a seated player elsewhere,
 * or remove them from the game entirely.
 *
 * Nothing here reseats anybody automatically. The roadmap parks automatic
 * seating under "hosts have opinions about who sits where", so every
 * rearrangement in this plan is somebody's deliberate act.
 *
 * This used to also carry a per-person "Unseat" button
 * (`onPlace(bookingId, null)`) and, separately, a "Seat at {table}" row for
 * every confirmed-but-unplaced booking in the whole game — the latter
 * rendered into EVERY table's own HostSeating, so one unplaced member
 * appeared once per table card, reading as "unseated and still at the
 * table" wherever a host could place them. The human removed both: seating
 * an unplaced booking now lives once, in WaitlistPanel's "Coming, not yet
 * seated" section (still via `placeBooking`, unchanged), and "Unseat" is
 * gone outright — a host who wants somebody off a table moves them
 * (`onPlace` with a real table id, below) or removes them from the game
 * (`onRemove`); deliberately parking a member in limbo was never the goal,
 * and the control cost a third of the per-person stack on a very tall
 * screen. `onPlace` keeps its `string | null` signature regardless — the
 * data-layer capability (`placeBooking(id, null)`) is unchanged, only the
 * button that called it with `null` from here is gone.
 *
 * `canCallForAFourth` is a prop, not a computation this component makes
 * itself — the caller (the event screen) derives it from occupancy and the
 * event's bookable window, the same rule `needsAFourth` implements minus the
 * 48-hour gate. `call_for_a_fourth` refuses a table that needs more than one
 * more player, so an unconditional button here would exist only to produce
 * an error.
 */
export default function HostSeating({
  occupants,
  tables,
  table,
  busy = false,
  canCallForAFourth,
  onPlace,
  onRemove,
  onCallForAFourth,
}: Props) {
  const elsewhere = tables.filter((t) => t.id !== table.id);

  return (
    <View style={styles.wrap}>
      {occupants.map((person) => (
        <View key={person.booking_id} style={styles.person}>
          <Text style={styles.name}>{person.display_name}</Text>
          <View style={styles.controls}>
            {elsewhere.map((other) => (
              <Button
                key={other.id}
                variant="secondary"
                big={false}
                disabled={busy}
                onPress={() => onPlace(person.booking_id, other.id)}
                accessibilityLabel={`Move ${person.display_name} to ${other.label}`}
              >
                {`Move to ${other.label}`}
              </Button>
            ))}
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={() => onRemove(person.booking_id)}
              accessibilityLabel={`Remove ${person.display_name} from this game`}
            >
              Remove from game
            </Button>
          </View>
        </View>
      ))}

      {/*
        call_for_a_fourth REFUSES a table that needs more than one player,
        so an unconditional button would exist only to produce an error.
      */}
      {canCallForAFourth ? (
        <Button
          variant="secondary"
          big={false}
          disabled={busy}
          onPress={() => onCallForAFourth(table.id)}
          accessibilityLabel={`Call for a fourth at ${table.label}`}
        >
          Call for a 4th now
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space[3], gap: space[3] },
  person: { gap: space[2] },
  name: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
