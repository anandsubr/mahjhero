import { Link, Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import Card from '../../components/Card';
import CheckInControl from '../../components/CheckInControl';
import ClubChips from '../../components/ClubChips';
import DashboardHeader from '../../components/DashboardHeader';
import DateTile from '../../components/DateTile';
import ErrorBanner from '../../components/ErrorBanner';
import NeedAFourthCard from '../../components/NeedAFourthCard';
import NoticeBanner from '../../components/NoticeBanner';
import Screen from '../../components/Screen';
import Skeleton from '../../components/Skeleton';
import TabBar from '../../components/TabBar';
import Tag from '../../components/Tag';
import {
  checkInOpen,
  clearAttendance,
  recordAttendance,
  type AttendanceState,
} from '../../lib/attendance';
import {
  acceptPromotionOffer,
  cancelBooking,
  commitBooking,
  declineBooking,
  declinePromotionOffer,
  fetchMyUpcomingBookings,
  offerCountdown,
  waitlistLabel,
} from '../../lib/bookings';
import type { MyBooking } from '../../lib/bookings';
import { fetchMyClubs } from '../../lib/clubs';
import type { Club } from '../../lib/clubs';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  ALL_CLUBS,
  buildChips,
  buildDashboardRows,
  headerScope,
  initialsFrom,
  inScope,
  needAFourthAlerts,
} from '../../lib/dashboard';
import type { DashboardRow, FourthAlert } from '../../lib/dashboard';
import { fetchUpcomingEvents, formatEventWhen } from '../../lib/events';
import type { ClubEvent } from '../../lib/events';
import { fetchProfile } from '../../lib/profile';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';

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
  const [checkInBusy, setCheckInBusy] = useState(false);

  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [profileName, setProfileName] = useState('');
  const [selected, setSelected] = useState<string>(ALL_CLUBS);
  const [notice, setNotice] = useState<string | null>(null);
  const [takeBusy, setTakeBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchMyClubs().then(async (result) => {
      if (cancelled) return;
      if (result === null) {
        setLoadFailed(true);
        setReady(true);
        return;
      }
      setClubs(result);
      // One read per club. Chatty by design for now — collapsing these into a
      // single RPC is deferred item 8 in the spec, and wants the screen's shape
      // to settle first. Failures degrade to "no open games" rather than
      // blanking the screen: the member's own bookings are the load-bearing
      // half and they came from a different call.
      const perClub = await Promise.all(
        result.map((club) => fetchUpcomingEvents(club.id)),
      );
      if (cancelled) return;
      setEvents(perClub.filter((list): list is ClubEvent[] => list !== null).flat());
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
    fetchProfile(userId).then((profile) => {
      if (cancelled) return;
      setProfileName(profile?.display_name ?? '');
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

  // Optimistic write with rollback on error, matching the event screen's
  // own `setMyCheckInState` (Task 11) -- one control for one person, so
  // there is no concurrent-write problem to reconcile against, unlike the
  // door screen. The write updates `bookings` in place rather than going
  // through `runBookingAction`/`reloadBookings`: that pair intentionally
  // waits for the server before showing anything, which is the wrong feel
  // for a two-state toggle the member expects to respond instantly.
  function handleCheckIn(booking: MyBooking, next: AttendanceState | null) {
    if (!userId) return;
    void setCheckInState(booking, userId, next);
  }

  async function setCheckInState(
    booking: MyBooking,
    profileId: string,
    next: AttendanceState | null,
  ) {
    const previous = booking.check_in_state;
    setBookings((prev) =>
      (prev ?? []).map((b) =>
        b.booking_id === booking.booking_id ? { ...b, check_in_state: next } : b,
      ),
    );
    setCheckInBusy(true);
    setActionError(null);
    const { error } =
      next === null
        ? await clearAttendance({ eventId: booking.event_id, profileId })
        : await recordAttendance({ eventId: booking.event_id, profileId, state: next });
    setCheckInBusy(false);
    if (error) {
      setBookings((prev) =>
        (prev ?? []).map((b) =>
          b.booking_id === booking.booking_id ? { ...b, check_in_state: previous } : b,
        ),
      );
      setActionError(error);
    }
  }

  // Taking the advertised seat: `preferredTableId` is the very table the
  // alert counted as one short, so the member lands with the three people
  // they were shown rather than wherever the server happens to have room.
  async function takeSeat(alert: FourthAlert) {
    setTakeBusy(true);
    setActionError(null);
    const { error } = await commitBooking({
      eventId: alert.eventId,
      players: [userId ?? ''],
      preferredTableId: alert.tableId,
      allowSplit: false,
    });
    setTakeBusy(false);
    if (error) {
      setActionError(error);
      return;
    }
    setNotice(`You're in — ${alert.text}.`);
    await reloadBookings();
  }

  // The same call with no table preference, and no notice — the row flipping
  // from Join to Seated is its own confirmation.
  async function joinGame(row: DashboardRow) {
    setTakeBusy(true);
    setActionError(null);
    const { error } = await commitBooking({
      eventId: row.eventId,
      players: [userId ?? ''],
      preferredTableId: null,
      allowSplit: false,
    });
    setTakeBusy(false);
    if (error) {
      setActionError(error);
      return;
    }
    await reloadBookings();
  }

  if (loading) {
    return (
      <Screen tabBar={<TabBar active="club" />}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accentColor} />
        </View>
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <View style={styles.list}>
          <Skeleton />
          <Skeleton delay={150} />
          <Skeleton delay={300} />
        </View>
      </Screen>
    );
  }

  if (loadFailed) {
    return (
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <Text style={styles.heading}>Your clubs</Text>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  const list = clubs ?? [];
  const chips = buildChips(list);
  const scope = headerScope(list, selected);
  const rows = buildDashboardRows({
    bookings: bookings ?? [],
    events,
    clubs: list,
    userId: userId ?? '',
  }).filter((row) => inScope(row.clubId, selected));
  const alerts = needAFourthAlerts({
    events,
    clubs: list,
    userId: userId ?? '',
  }).filter((alert) => inScope(alert.clubId, selected));

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      <DashboardHeader
        kicker={scope.kicker}
        name={scope.name}
        meta={scope.meta}
        initials={initialsFrom(profileName)}
        onPressAvatar={() => router.push('/profile')}
      />

      {list.length > 1 ? (
        <ClubChips chips={chips} selected={selected} onSelect={setSelected} />
      ) : null}

      {notice ? (
        <NoticeBanner message={notice} onDismiss={() => setNotice(null)} />
      ) : null}

      {actionError ? <ErrorBanner message={actionError} /> : null}

      {alerts.map((alert) => (
        <NeedAFourthCard
          key={`${alert.eventId}:${alert.tableId}`}
          clubName={alert.clubName}
          text={alert.text}
          busy={takeBusy}
          onTake={() => void takeSeat(alert)}
        />
      ))}

      <Text style={styles.sectionTitle}>Your games</Text>

      {bookingsFailed ? (
        <Text style={styles.help}>Could not load your games.</Text>
      ) : rows.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.help}>Nothing else coming up.</Text>
          {selected !== ALL_CLUBS ? (
            <Button
              variant="secondary"
              big={false}
              onPress={() => router.push(`/clubs/${selected}/events/new`)}
              accessibilityLabel="Host a table"
            >
              Host a table
            </Button>
          ) : null}
        </View>
      ) : (
        rows.map((row) => (
          <GameRow
            key={row.eventId}
            row={row}
            youId={userId}
            busy={actionBusy}
            takeBusy={takeBusy}
            checkInBusy={checkInBusy}
            onJoin={joinGame}
            onDecline={handleDecline}
            onAcceptOffer={handleAcceptOffer}
            onDeclineOffer={handleDeclineOffer}
            onLeaveWaitlist={handleLeaveWaitlist}
            onCheckIn={handleCheckIn}
          />
        ))
      )}

      <Text style={styles.sectionTitle}>Your clubs</Text>

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
    </Screen>
  );
}

/**
 * One row of "Your games": the artboard's date tile, the club and title, and
 * a single right-hand affordance — Join for an open game the member is not in
 * yet, "Seated" for one they hold.
 *
 * A joinable row carries no booking, so none of the seat-management controls
 * apply to it; everything they need lives in `BookingSeatControls` below,
 * rendered only when `row.booking` is there.
 */
function GameRow({
  row,
  youId,
  busy,
  takeBusy,
  checkInBusy,
  onJoin,
  onDecline,
  onAcceptOffer,
  onDeclineOffer,
  onLeaveWaitlist,
  onCheckIn,
}: {
  row: DashboardRow;
  youId: string | undefined;
  busy: boolean;
  takeBusy: boolean;
  checkInBusy: boolean;
  onJoin: (row: DashboardRow) => void;
  onDecline: (booking: MyBooking) => void;
  onAcceptOffer: (booking: MyBooking) => void;
  onDeclineOffer: (booking: MyBooking) => void;
  onLeaveWaitlist: (booking: MyBooking) => void;
  onCheckIn: (booking: MyBooking, next: AttendanceState | null) => void;
}) {
  const booking = row.booking;

  return (
    <Card>
      <View style={styles.gameRow}>
        <DateTile startsAt={row.startsAt} timezone={row.timezone} />
        <View style={styles.gameBody}>
          <Text style={styles.gameKicker}>{row.clubName}</Text>
          <Text style={styles.gameTitle}>{row.title}</Text>
          <Text style={styles.help}>
            {formatEventWhen(row.startsAt, row.timezone)}
            {' · '}
            {row.venueName}
          </Text>
        </View>
        {booking === null ? (
          <Button
            variant="secondary"
            big={false}
            disabled={takeBusy}
            onPress={() => onJoin(row)}
            accessibilityLabel={`Join ${row.title}`}
            style={styles.gameAction}
          >
            Join
          </Button>
        ) : booking.status === 'confirmed' ? (
          <Tag variant="accent2">Seated</Tag>
        ) : null}
      </View>

      {booking !== null ? (
        <BookingSeatControls
          booking={booking}
          youId={youId}
          busy={busy}
          checkInBusy={checkInBusy}
          onDecline={onDecline}
          onAcceptOffer={onAcceptOffer}
          onDeclineOffer={onDeclineOffer}
          onLeaveWaitlist={onLeaveWaitlist}
          onCheckIn={onCheckIn}
        />
      ) : null}
    </Card>
  );
}

/**
 * The seat this member holds, and whatever they can do about it. Each booking
 * carries its own action, in priority order: a live offer (accept/decline,
 * with its countdown) beats a seat someone else booked for you (decline),
 * which beats a self-held waitlist spot (leave the waitlist). An ordinary
 * confirmed seat you booked yourself has nothing to press.
 *
 * Split out of `GameRow` rather than inlined behind a `booking !== null`
 * ternary so every derivation below can read a non-null `MyBooking` directly,
 * exactly as it did when this was one component — no non-null assertions
 * threaded through logic whose whole job is to be exact.
 */
function BookingSeatControls({
  booking,
  youId,
  busy,
  checkInBusy,
  onDecline,
  onAcceptOffer,
  onDeclineOffer,
  onLeaveWaitlist,
  onCheckIn,
}: {
  booking: MyBooking;
  youId: string | undefined;
  busy: boolean;
  checkInBusy: boolean;
  onDecline: (booking: MyBooking) => void;
  onAcceptOffer: (booking: MyBooking) => void;
  onDeclineOffer: (booking: MyBooking) => void;
  onLeaveWaitlist: (booking: MyBooking) => void;
  onCheckIn: (booking: MyBooking, next: AttendanceState | null) => void;
}) {
  const hasOffer =
    booking.offer_id !== null &&
    booking.offer_seats !== null &&
    booking.offer_expires_at !== null;

  // `promote_waitlist` caps an offer's `expires_at` at
  // `least(now() + 2h, ev.starts_at)` (20260825010000_waitlist_promotion.sql),
  // so any offer still unresponded at kickoff is already expired. But this
  // row's offer fields come from `my_upcoming_bookings`'s join on
  // `po.responded_at is null` alone -- no expiry check -- and
  // `sweep_promotion_offers` only clears a lapsed offer every five minutes.
  // So `hasOffer` alone stays true for a while (sometimes a long while, if
  // the sweep is behind) after the offer has actually lapsed. Gating the
  // buttons on `starts_at > now()` like the branches below would miss this:
  // `accept_promotion_offer` re-checks `expires_at` under lock regardless of
  // whether the game has started (20260825100000_..._capacity_guard.sql),
  // so the offer's OWN expiry -- not the game's start time -- is the
  // invariant that actually predicts a refusal.
  const offerLive = hasOffer && new Date(booking.offer_expires_at as string).getTime() > Date.now();

  // Task 8 keeps an in-progress game in this list so the member has
  // somewhere to check in -- which also keeps this row's seat-management
  // buttons on screen past kickoff, where `cancel_booking` and
  // `decline_booking` both refuse with "event already started" the moment
  // `starts_at` passes. The refusal is graceful (mapped to friendly copy
  // in lib/bookings.ts), but a button whose only possible outcome is an
  // error should not be offered.
  const notStarted = new Date(booking.starts_at).getTime() > Date.now();

  // Renders only when the write can actually succeed: a CONFIRMED seat
  // (a waitlisted member has no seat, and `record_attendance` refuses them
  // -- drawing a control guaranteed to fail is worse than drawing none),
  // the event asking for check-in at all, and the server-supplied window
  // being open. `checkInOpen` owns the one-hour lead; it is not
  // re-derived here.
  const showCheckIn =
    booking.status === 'confirmed' &&
    booking.check_in_required &&
    checkInOpen(booking.check_in_opens_at, booking.check_in_closes_at);

  // An offer being held supersedes the plain seat-status line below — a
  // member being asked to accept or decline a seat is not, in that
  // moment, merely "waiting" for one.
  const seatStatus = hasOffer
    ? null
    : booking.table_label
      ? booking.table_label
      : booking.status === 'waitlisted'
        ? booking.waitlist_position !== null
          ? waitlistLabel(booking.waitlist_position)
          : 'Waiting for a seat'
        : 'Not seated yet';

  const bookedByOther = booking.booked_by !== youId;

  return (
    <>
      {seatStatus ? <Text style={styles.help}>{seatStatus}</Text> : null}

      {offerLive ? (
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
            accessibilityLabel={`Decline the ${booking.offer_seats} ${
              booking.offer_seats === 1 ? 'seat' : 'seats'
            } offered for ${booking.event_title}`}
          >
            No thanks
          </Button>
        </>
      ) : hasOffer ? (
        // The offer is still sitting in the data (sweep hasn't cleared it
        // yet) but has already lapsed -- surfacing neither a countdown that
        // would just say "Expired" nor two buttons that would just raise
        // "offer expired" (lib/bookings.ts). Same sentence
        // `promotion_offer_expired`'s notification and that RPC refusal
        // both already use, so a member who saw either one recognizes this.
        <Text style={styles.help}>
          {"That offer has expired — you're still on the waitlist."}
        </Text>
      ) : bookedByOther ? (
        <>
          <Text style={styles.friendNote}>
            {booking.booked_by_name} booked this for you
          </Text>
          {notStarted ? (
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={() => onDecline(booking)}
              accessibilityLabel={`Decline the seat ${booking.booked_by_name} booked`}
            >
              Decline
            </Button>
          ) : null}
        </>
      ) : booking.status === 'waitlisted' ? (
        notStarted ? (
          <Button
            variant="ghost"
            big={false}
            disabled={busy}
            onPress={() => onLeaveWaitlist(booking)}
            accessibilityLabel={`Leave the waitlist for ${booking.event_title}`}
          >
            Leave the waitlist
          </Button>
        ) : null
      ) : null}

      {showCheckIn ? (
        <CheckInControl
          state={booking.check_in_state}
          label="you"
          busy={checkInBusy}
          onChange={(next) => onCheckIn(booking, next)}
        />
      ) : null}
    </>
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
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  gameBody: {
    flex: 1,
    minWidth: 0,
  },
  gameKicker: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  gameTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: 1,
  },
  gameAction: {
    flexShrink: 0,
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[2],
  },
  emptyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.card,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.neutral[400],
  },
});
