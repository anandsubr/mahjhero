import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

export type Seat = {
  bookingId: string;
  name: string;
  isYou: boolean;
};

type Props = {
  tableLabel: string;
  capacity: number;
  seats: Seat[];
  /** Omitted for a read-only render — a cancelled game, or somebody else's. */
  onTakeSeat?: () => void;
  busy?: boolean;
  needsFourth?: boolean;
};

/**
 * One table's seats.
 *
 * Occupied seats are drawn in the order they are given, then the remainder
 * are drawn empty. Nothing here numbers a seat, and nothing may: the schema
 * COUNTS seats, and a UI that implies Table 2 seat 3 is a durable place
 * teaches members to expect something the data cannot promise.
 *
 * Empty count floors at zero. A table can hold more people than it seats
 * after a host removes another table, and rendering a negative number of
 * empty chairs is not a state anybody needs to see.
 */
export default function SeatGrid({
  tableLabel,
  capacity,
  seats,
  onTakeSeat,
  busy = false,
  needsFourth = false,
}: Props) {
  const empties = Math.max(0, capacity - seats.length);
  const lastSeatCall = needsFourth && empties === 1;

  return (
    <View style={styles.grid}>
      {seats.map((seat) => (
        <View
          key={seat.bookingId}
          style={[styles.seat, seat.isYou && styles.seatYou]}
        >
          <Text style={[styles.name, seat.isYou && styles.nameYou]}>
            {seat.isYou ? 'You' : seat.name}
          </Text>
        </View>
      ))}

      {Array.from({ length: empties }, (_, index) => (
        <Pressable
          key={`empty-${index}`}
          style={[styles.seat, styles.empty, lastSeatCall && styles.calling]}
          onPress={busy ? undefined : onTakeSeat}
          disabled={busy || !onTakeSeat}
          accessibilityRole="button"
          accessibilityLabel={
            lastSeatCall
              ? `Take the last seat at ${tableLabel}`
              : `Take a seat at ${tableLabel}`
          }
          accessibilityState={{ disabled: busy || !onTakeSeat }}
        >
          {/*
           * Deliberately NOT the string "Needs a 4th" — TableCard already
           * shows that exact text once, as a Tag next to the table label.
           * Repeating it here would give `screen.getByText('Needs a 4th')`
           * two matches and throw, and a screen reader two elements with
           * identical text and no way to tell them apart. This cell's own
           * accessibilityLabel ("Take the last seat at …") is what actually
           * distinguishes it; the visible word here just echoes that call.
           */}
          <Text style={[styles.emptyText, lastSeatCall && styles.callingText]}>
            {lastSeatCall ? 'Last seat' : 'Empty'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[3],
  },
  seat: {
    flexGrow: 1,
    flexBasis: '44%',
    borderRadius: radius.sm,
    paddingVertical: space[3],
    paddingHorizontal: space[3],
    backgroundColor: colors.neutral[300],
    justifyContent: 'center',
  },
  seatYou: { backgroundColor: colors.accent2Color },
  empty: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
    alignItems: 'center',
  },
  calling: { borderColor: colors.accentColor },
  // lib/theme's `type` is a token bag — font FAMILIES plus a `size` map —
  // not a set of ready-made style objects. There is no `type.body` to
  // spread; every text style is written out from the tokens.
  name: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  nameYou: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.neutral[100],
  },
  emptyText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.textMuted,
  },
  callingText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accent[700],
  },
});
