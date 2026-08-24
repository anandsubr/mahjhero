import { StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import Card from './Card';
import type { SeatOccupant } from '../lib/bookings';
import { offerCountdown, waitlistLabel } from '../lib/bookings';
import { colors, space, type } from '../lib/theme';

/** Only what this panel's "Seat at …" buttons need — not the full EventTable. */
type SeatableTable = { id: string; label: string };

type Props = {
  unseated: SeatOccupant[];
  waiting: SeatOccupant[];
  youId: string;
  offer: { id: string; seats: number; expires_at: string } | null;
  now: Date;
  busy?: boolean;
  onAcceptOffer?: () => void;
  onDeclineOffer?: () => void;
  onLeaveWaitlist?: () => void;
  /**
   * Host-only. When both `tables` and `onSeat` are supplied, each unseated
   * person gets one "Seat at {table}" button per table; a plain member
   * (who cannot seat anyone) gets neither, and sees the read-only "The host
   * will place them" line instead. Deliberately the ONLY place a
   * confirmed-but-unplaced booking is offered a seat now — see this
   * component's own docstring.
   */
  tables?: SeatableTable[];
  onSeat?: (bookingId: string, tableId: string) => void;
};

/**
 * Everything about this game that is not a seat: people confirmed but not
 * yet placed, the queue in order, and any offer being held for you.
 *
 * The offer is read from `promotion_offers`, which is live state — not from
 * the outbox. The outbox is plan 6's queue and nobody reads it.
 *
 * "Coming, not yet seated" is the single home for an unplaced booking.
 * HostSeating used to also render a "Seat at {table}" row for every such
 * booking, on EVERY table's own card — so one unplaced member appeared once
 * per table, reading as "unseated and still at the table" wherever a host
 * could place them. The human's fix: list them here exactly once, and let a
 * host seat them from this one row via `tables`/`onSeat`, which call the
 * same `placeBooking` RPC HostSeating already used (unchanged; still takes
 * a table id).
 */
export default function WaitlistPanel({
  unseated,
  waiting,
  youId,
  offer,
  now,
  busy = false,
  onAcceptOffer,
  onDeclineOffer,
  onLeaveWaitlist,
  tables,
  onSeat,
}: Props) {
  const canSeat = Boolean(tables?.length && onSeat);
  const yourPlace = waiting.find((w) => w.profile_id === youId);

  if (!unseated.length && !waiting.length && !offer) return null;

  return (
    <>
      {offer ? (
        <Card>
          <Text style={styles.heading}>
            {offer.seats} {offer.seats === 1 ? 'seat is' : 'seats are'} free for
            your group
          </Text>
          <Text style={styles.help}>
            {offerCountdown(new Date(offer.expires_at), now)}
          </Text>
          <Button
            block
            disabled={busy}
            onPress={() => onAcceptOffer?.()}
            accessibilityLabel={`Take the ${offer.seats} ${offer.seats === 1 ? 'seat' : 'seats'}`}
          >
            {`Take ${offer.seats === 1 ? 'the seat' : `the ${offer.seats} seats`}`}
          </Button>
          <Button
            variant="ghost"
            big={false}
            disabled={busy}
            onPress={() => onDeclineOffer?.()}
            accessibilityLabel="Decline the offer"
          >
            No thanks
          </Button>
        </Card>
      ) : null}

      {unseated.length ? (
        <Card>
          <Text style={styles.heading}>Coming, not yet seated</Text>
          {unseated.map((person) => (
            <View key={person.booking_id} style={styles.unseatedRow}>
              <Text style={styles.person}>
                {person.profile_id === youId ? 'You' : person.display_name}
              </Text>
              {canSeat ? (
                <View style={styles.seatButtons}>
                  {tables!.map((t) => (
                    <Button
                      key={t.id}
                      variant="secondary"
                      big={false}
                      disabled={busy}
                      onPress={() => onSeat!(person.booking_id, t.id)}
                      accessibilityLabel={`Seat ${person.display_name} at ${t.label}`}
                    >
                      {`Seat at ${t.label}`}
                    </Button>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
          {/*
            Only shown to a member, who cannot act on this list themselves —
            a host sees the "Seat at …" buttons above instead, which already
            say what to do.
          */}
          {!canSeat ? (
            <Text style={styles.help}>
              The host will place {unseated.length === 1 ? 'them' : 'these players'} at a table.
            </Text>
          ) : null}
        </Card>
      ) : null}

      {waiting.length ? (
        <Card>
          <Text style={styles.heading}>Waiting for a seat</Text>
          {waiting.map((person) => (
            <Text key={person.booking_id} style={styles.person}>
              {person.waitlist_position}. {person.profile_id === youId ? 'You' : person.display_name}
            </Text>
          ))}
          {yourPlace?.waitlist_position ? (
            <Text style={styles.help}>
              {waitlistLabel(yourPlace.waitlist_position)}
            </Text>
          ) : null}
          {yourPlace && onLeaveWaitlist ? (
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={onLeaveWaitlist}
              accessibilityLabel="Leave the waitlist"
            >
              Leave the waitlist
            </Button>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  unseatedRow: {
    gap: space[2],
  },
  seatButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
  },
  person: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[1],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: space[2],
  },
});
