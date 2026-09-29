import { StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import Button from '../Button';
import Card from '../Card';
import ErrorBanner from '../ErrorBanner';
import NeedAFourthCard from '../NeedAFourthCard';
import NoticeBanner from '../NoticeBanner';
import { offerCountdown, type MyBooking } from '../../lib/bookings';
import type { PendingInvite } from '../../lib/clubs';
import { formatEventWhen } from '../../lib/events';
import type { NeedsYou } from '../../lib/use-needs-you';
import { colors, space, type } from '../../lib/theme';

/**
 * A pending club invite (fetch_my_pending_invites). Moved verbatim from the
 * old dashboard (app/clubs/index.tsx). Home renders the stack for members in
 * no club too, so an invite to someone with no other membership stays
 * reachable -- the old dashboard once lost exactly that case to an early
 * return.
 */
function PendingInviteCards({
  invites,
  busy,
  onAccept,
  onDecline,
}: {
  invites: PendingInvite[];
  busy: boolean;
  onAccept: (invite: PendingInvite) => void;
  onDecline: (invite: PendingInvite) => void;
}) {
  return (
    <>
      {invites.map((invite) => (
        <Card key={invite.id}>
          <Text style={styles.inviteHeading}>
            {invite.clubName} invited you to join
            {invite.eventTitle ? ` — ${invite.eventTitle}` : ''}
          </Text>
          <Button
            block
            disabled={busy}
            onPress={() => onAccept(invite)}
            accessibilityLabel={`Join ${invite.clubName}`}
          >
            Join
          </Button>
          <Button
            variant="ghost"
            big={false}
            disabled={busy}
            onPress={() => onDecline(invite)}
            accessibilityLabel={`Decline the invite to ${invite.clubName}`}
          >
            No thanks
          </Button>
        </Card>
      ))}
    </>
  );
}

/**
 * A pending game invite (bookings.status 'invited', from
 * my_upcoming_bookings) -- the invitee's one dashboard surface for
 * answering it. Sits beside the club-invite card: both are "somebody asked
 * you something", and neither belongs in "Your games" until it is
 * answered.
 */
function GameInviteCards({
  invites,
  busy,
  onAccept,
  onDecline,
}: {
  invites: MyBooking[];
  busy: boolean;
  onAccept: (booking: MyBooking) => void;
  onDecline: (booking: MyBooking) => void;
}) {
  return (
    <>
      {invites.map((invite) => {
        const where = invite.table_label
          ? ` — ${invite.table_label}`
          : invite.invite_holds_seat === false
            ? " — you'd join the waitlist"
            : '';
        return (
          <Card key={invite.booking_id}>
            <Text style={styles.inviteHeading}>
              {`${invite.booked_by_name} invited you to ${invite.event_title}${where}`}
            </Text>
            <Text style={styles.help}>
              {`${invite.club_name} · ${formatEventWhen(invite.starts_at, invite.club_timezone)}`}
            </Text>
            <Button
              block
              disabled={busy}
              onPress={() => onAccept(invite)}
              accessibilityLabel={`Accept the invite to ${invite.event_title}`}
            >
              Accept
            </Button>
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={() => onDecline(invite)}
              accessibilityLabel={`Decline ${invite.booked_by_name}'s invite to ${invite.event_title}`}
            >
              Decline
            </Button>
          </Card>
        );
      })}
    </>
  );
}


function OfferCard({
  offer,
  busy,
  onAccept,
  onDecline,
}: {
  offer: MyBooking;
  busy: boolean;
  onAccept: (b: MyBooking) => void;
  onDecline: (b: MyBooking) => void;
}) {
  const seats = offer.offer_seats ?? 1;
  return (
    <Card>
      <Text style={styles.inviteHeading}>{`A seat opened up — ${offer.event_title}`}</Text>
      <Text style={styles.help}>
        {`${offer.club_name} · ${formatEventWhen(offer.starts_at, offer.club_timezone)}`}
      </Text>
      <Text style={styles.help}>
        {offerCountdown(new Date(offer.offer_expires_at as string), new Date())}
      </Text>
      <Button
        block
        disabled={busy}
        onPress={() => onAccept(offer)}
        accessibilityLabel={`Take the ${seats} ${seats === 1 ? 'seat' : 'seats'}`}
      >
        {`Take ${seats === 1 ? 'the seat' : `the ${seats} seats`}`}
      </Button>
      <Button
        variant="ghost"
        big={false}
        disabled={busy}
        onPress={() => onDecline(offer)}
        accessibilityLabel={`Decline the ${seats} ${seats === 1 ? 'seat' : 'seats'} offered for ${offer.event_title}`}
      >
        No thanks
      </Button>
    </Card>
  );
}

/** Home's "Needs you" stack. Renders nothing when there is nothing to act on. */
export default function NeedsYouStack({ needs }: { needs: NeedsYou }) {
  const empty =
    needs.clubInvites.length === 0 &&
    needs.gameInvites.length === 0 &&
    needs.offers.length === 0 &&
    needs.alerts.length === 0 &&
    !needs.notice &&
    !needs.error;
  if (empty) return null;

  return (
    <View style={styles.stack}>
      {needs.notice ? <NoticeBanner message={needs.notice} onDismiss={needs.dismissNotice} /> : null}
      {needs.error ? <ErrorBanner message={needs.error} /> : null}
      <PendingInviteCards
        invites={needs.clubInvites}
        busy={needs.busy}
        onAccept={needs.acceptClubInvite}
        onDecline={needs.declineClubInvite}
      />
      <GameInviteCards
        invites={needs.gameInvites}
        busy={needs.busy}
        onAccept={needs.acceptGameInvite}
        onDecline={needs.declineGameInvite}
      />
      {needs.offers.map((offer) => (
        <OfferCard
          key={offer.booking_id}
          offer={offer}
          busy={needs.busy}
          onAccept={needs.acceptOffer}
          onDecline={needs.declineOffer}
        />
      ))}
      {needs.alerts.map((alert) => (
        <NeedAFourthCard
          key={`${alert.eventId}:${alert.tableId}`}
          clubName={alert.clubName}
          text={alert.text}
          busy={needs.busy}
          onTake={() => needs.takeSeat(alert)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  // Copied from app/clubs/index.tsx's StyleSheet with the cards above.
  inviteHeading: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
