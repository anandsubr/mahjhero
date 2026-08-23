import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import type { SeatOccupant } from '../lib/bookings';
import type { EventTable } from '../lib/events';
import { colors, space, type } from '../lib/theme';

type Props = {
  /** Everybody seated at THIS table. */
  occupants: SeatOccupant[];
  /** Confirmed but unplaced, anywhere in this game. */
  unseated?: SeatOccupant[];
  tables: EventTable[];
  table: EventTable;
  busy?: boolean;
  canCallForAFourth: boolean;
  onPlace: (bookingId: string, tableId: string | null) => void;
  onRemove: (bookingId: string) => void;
  onCallForAFourth: (tableId: string) => void;
};

/**
 * The organizer's controls for one table.
 *
 * Nothing here reseats anybody automatically. The roadmap parks automatic
 * seating under "hosts have opinions about who sits where", so every
 * rearrangement in this plan is somebody's deliberate act.
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
  unseated = [],
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
            {/*
              Unseating is NOT removal: the member is still coming, they
              just have no chair yet (placeBooking(id, null)). Removal
              (cancelBooking) takes them out of the game and is not
              undoable. Two separate controls because the two acts are not
              the same, and the labels must not blur that.
            */}
            <Button
              variant="secondary"
              big={false}
              disabled={busy}
              onPress={() => onPlace(person.booking_id, null)}
              accessibilityLabel={`Unseat ${person.display_name}`}
            >
              Unseat
            </Button>
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

      {unseated.map((person) => (
        <View key={person.booking_id} style={styles.person}>
          <Text style={styles.name}>{person.display_name}</Text>
          <Button
            variant="secondary"
            big={false}
            disabled={busy}
            onPress={() => onPlace(person.booking_id, table.id)}
            accessibilityLabel={`Seat ${person.display_name} at ${table.label}`}
          >
            {`Seat at ${table.label}`}
          </Button>
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
