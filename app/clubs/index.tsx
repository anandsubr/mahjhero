import { Link, Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import Card from '../../components/Card';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import {
  acceptPromotionOffer,
  cancelBooking,
  declineBooking,
  declinePromotionOffer,
  fetchMyUpcomingBookings,
  offerCountdown,
} from '../../lib/bookings';
import type { MyBooking } from '../../lib/bookings';
import { fetchMyClubs } from '../../lib/clubs';
import type { Club } from '../../lib/clubs';
import { GENERIC_ERROR } from '../../lib/constants';
import { formatEventWhen } from '../../lib/events';
import { useSession } from '../../lib/session';
import { colors, space, type } from '../../lib/theme';

export default function ClubsScreen() {
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const router = useRouter();
  const [clubs, setClubs] = useState<Club[] | null>(null);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Kept separate from `loadFailed`: the clubs are what this screen is
  // for, so a failed bookings fetch degrades only the "Your games" section
  // rather than blanking the whole screen — same split as
  // app/clubs/[id]/index.tsx's `eventsFailed`.
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [bookingsFailed, setBookingsFailed] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchMyClubs().then((result) => {
      if (cancelled) return;
      if (result === null) setLoadFailed(true);
      else setClubs(result);
      setReady(true);
    });
    fetchMyUpcomingBookings().then((result) => {
      if (cancelled) return;
      if (result === null) setBookingsFailed(true);
      else {
        setBookings(result);
        setBookingsFailed(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function reloadBookings() {
    const result = await fetchMyUpcomingBookings();
    if (result === null) setBookingsFailed(true);
    else {
      setBookings(result);
      setBookingsFailed(false);
    }
  }

  // Same shape as the event screen's own `run` helper: render the data
  // layer's refusal verbatim (never a generic "check your connection"),
  // and only reload once the write actually succeeded.
  async function runBookingAction(action: () => Promise<{ error: string | null }>) {
    setActionBusy(true);
    setActionError(null);
    const { error } = await action();
    setActionBusy(false);
    if (error) {
      setActionError(error);
      return;
    }
    await reloadBookings();
  }

  function handleDecline(booking: MyBooking) {
    void runBookingAction(() => declineBooking(booking.booking_id));
  }

  function handleAcceptOffer(booking: MyBooking) {
    if (!booking.offer_id) return;
    const offerId = booking.offer_id;
    void runBookingAction(() => acceptPromotionOffer(offerId));
  }

  function handleDeclineOffer(booking: MyBooking) {
    if (!booking.offer_id) return;
    const offerId = booking.offer_id;
    void runBookingAction(() => declinePromotionOffer(offerId));
  }

  function handleLeaveWaitlist(booking: MyBooking) {
    void runBookingAction(() => cancelBooking(booking.booking_id));
  }

  if (loading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (loadFailed) {
    return (
      <Screen contentStyle={styles.container}>
        <Text style={styles.heading}>Your clubs</Text>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  const list = clubs ?? [];
  const myGames = bookings ?? [];
  const showGamesSection = bookingsFailed || myGames.length > 0;

  return (
    <Screen contentStyle={styles.container}>
      {showGamesSection ? (
        <View style={styles.gamesSection}>
          <Text style={styles.heading}>Your games</Text>

          {actionError ? <ErrorBanner message={actionError} /> : null}

          {bookingsFailed ? (
            <Text style={styles.help}>Could not load your games.</Text>
          ) : (
            myGames.map((booking) => (
              <BookingCard
                key={booking.booking_id}
                booking={booking}
                youId={userId}
                busy={actionBusy}
                onDecline={handleDecline}
                onAcceptOffer={handleAcceptOffer}
                onDeclineOffer={handleDeclineOffer}
                onLeaveWaitlist={handleLeaveWaitlist}
              />
            ))
          )}
        </View>
      ) : null}

      <Text style={styles.heading}>Your clubs</Text>

      {list.length === 0 ? (
        <View style={styles.list}>
          <Text style={styles.help}>
            You are not in a club yet. Start one and invite the people you
            already play with.
          </Text>
          <Button
            onPress={() => router.push('/clubs/new')}
            accessibilityLabel="Start a club"
          >
            Start a club
          </Button>
        </View>
      ) : (
        <View style={styles.list}>
          {list.map((club) => (
            // Card is a plain function component that neither declares
            // accessibilityRole/accessibilityLabel in its prop type nor
            // spreads unrecognised props onto its underlying View, and it
            // isn't wrapped in forwardRef — so `Link asChild` cloning
            // straight onto <Card> fails to typecheck (excess props) and,
            // even past that, would silently drop the onPress/onClick Link
            // injects, leaving the card inert. Pressable is what actually
            // receives Link's injected handler and accessibility props;
            // Card nests inside purely for its visual styling. See the
            // Task 4 report for the full writeup of this deviation from the
            // brief's literal composition.
            <Link key={club.id} href={`/clubs/${club.id}`} asChild>
              <Pressable accessibilityRole="button" accessibilityLabel={club.name}>
                <Card>
                  <Text style={styles.clubName}>{club.name}</Text>
                  {club.rhythm.length > 0 ? (
                    <Text style={styles.help}>{club.rhythm}</Text>
                  ) : null}
                </Card>
              </Pressable>
            </Link>
          ))}
          <Button
            variant="secondary"
            onPress={() => router.push('/clubs/new')}
            accessibilityLabel="Start another club"
          >
            Start another club
          </Button>
        </View>
      )}

      <Link href="/profile" style={styles.linkRow}>
        <Text style={styles.link}>Your profile</Text>
      </Link>
    </Screen>
  );
}

/**
 * One row of "Your games". Each booking carries its own action, in
 * priority order: a live offer (accept/decline, with its countdown) beats
 * a seat someone else booked for you (decline), which beats a self-held
 * waitlist spot (leave the waitlist). An ordinary confirmed seat you
 * booked yourself has nothing to press.
 */
function BookingCard({
  booking,
  youId,
  busy,
  onDecline,
  onAcceptOffer,
  onDeclineOffer,
  onLeaveWaitlist,
}: {
  booking: MyBooking;
  youId: string | undefined;
  busy: boolean;
  onDecline: (booking: MyBooking) => void;
  onAcceptOffer: (booking: MyBooking) => void;
  onDeclineOffer: (booking: MyBooking) => void;
  onLeaveWaitlist: (booking: MyBooking) => void;
}) {
  const hasOffer =
    booking.offer_id !== null &&
    booking.offer_seats !== null &&
    booking.offer_expires_at !== null;

  // An offer being held supersedes the plain seat-status line below — a
  // member being asked to accept or decline a seat is not, in that
  // moment, merely "waiting" for one.
  const seatStatus = hasOffer
    ? null
    : booking.table_label
      ? booking.table_label
      : booking.status === 'waitlisted'
        ? 'Waiting for a seat'
        : 'Not seated yet';

  const bookedByOther = booking.booked_by !== youId;

  return (
    <Card>
      <Text style={styles.clubName}>{booking.event_title}</Text>
      <Text style={styles.help}>
        {formatEventWhen(booking.starts_at, booking.club_timezone)}
      </Text>
      <Text style={styles.help}>{booking.venue_name}</Text>
      <Text style={styles.help}>{booking.club_name}</Text>

      {seatStatus ? <Text style={styles.help}>{seatStatus}</Text> : null}

      {hasOffer ? (
        <>
          <Text style={styles.help}>
            {offerCountdown(new Date(booking.offer_expires_at as string), new Date())}
          </Text>
          <Button
            block
            disabled={busy}
            onPress={() => onAcceptOffer(booking)}
            accessibilityLabel={`Take the ${booking.offer_seats} ${
              booking.offer_seats === 1 ? 'seat' : 'seats'
            }`}
          >
            {`Take ${booking.offer_seats === 1 ? 'the seat' : `the ${booking.offer_seats} seats`}`}
          </Button>
          <Button
            variant="ghost"
            big={false}
            disabled={busy}
            onPress={() => onDeclineOffer(booking)}
            accessibilityLabel="Decline the offer"
          >
            No thanks
          </Button>
        </>
      ) : bookedByOther ? (
        <>
          <Text style={styles.friendNote}>
            {booking.booked_by_name} booked this for you
          </Text>
          <Button
            variant="ghost"
            big={false}
            disabled={busy}
            onPress={() => onDecline(booking)}
            accessibilityLabel={`Decline the seat ${booking.booked_by_name} booked`}
          >
            Decline
          </Button>
        </>
      ) : booking.status === 'waitlisted' ? (
        <Button
          variant="ghost"
          big={false}
          disabled={busy}
          onPress={() => onLeaveWaitlist(booking)}
          accessibilityLabel={`Leave the waitlist for ${booking.event_title}`}
        >
          Leave the waitlist
        </Button>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: {
    // Every other screen gets its side margins from its own `contentStyle`
    // padding — Screen itself has no default padding, each screen supplies
    // space[6] in its container style. This screen never did, so "Your
    // clubs" and the cards sat flush with the viewport edge. See the
    // "no page padding" item in todo.md.
    padding: space[6],
    gap: space[4],
  },
  gamesSection: {
    gap: space[3],
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  // The list container's own gap, distinct from `container`'s page-level
  // gap between major sections — this is what puts space between the last
  // club card (or the empty-state help text) and the "Start another club"
  // / "Start a club" button below it, instead of them rendering as
  // adjacent siblings with nothing between them. See the "no space between
  // the last club and the button" item in todo.md.
  list: {
    gap: space[3],
  },
  clubName: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  friendNote: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  linkRow: { marginTop: space[6] },
  link: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accentColor,
  },
});
