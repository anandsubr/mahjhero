import { StyleSheet, Text } from 'react-native';
import Button from './Button';
import Card from './Card';
import type { SeatOccupant } from '../lib/bookings';
import { offerCountdown, waitlistLabel } from '../lib/bookings';
import { colors, space, type } from '../lib/theme';

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
};

/**
 * Everything about this game that is not a seat: people confirmed but not
 * yet placed, the queue in order, and any offer being held for you.
 *
 * The offer is read from `promotion_offers`, which is live state — not from
 * the outbox. The outbox is plan 6's queue and nobody reads it.
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
}: Props) {
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
            <Text key={person.booking_id} style={styles.person}>
              {person.profile_id === youId ? 'You' : person.display_name}
            </Text>
          ))}
          <Text style={styles.help}>
            The host will place {unseated.length === 1 ? 'them' : 'these players'} at a table.
          </Text>
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
