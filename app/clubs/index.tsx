import { Link, Redirect, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../components/Button';
import Card from '../../components/Card';
import CheckInControl from '../../components/CheckInControl';
import ClubChips from '../../components/ClubChips';
import DashboardHeader from '../../components/DashboardHeader';
import DateTile from '../../components/DateTile';
import ErrorBanner from '../../components/ErrorBanner';
import MahjongTile from '../../components/MahjongTile';
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
import type { BookingOutcome, MyBooking } from '../../lib/bookings';
import { canInvite, fetchMyClubs, fetchMyRoles } from '../../lib/clubs';
import type { Club, ClubRole } from '../../lib/clubs';
import { applyGreetingTemplate, fetchGreetings, pickDailyGreeting } from '../../lib/greetings';
import type { Greeting } from '../../lib/greetings';
import { fetchProfile } from '../../lib/profile';
import { GENERIC_ERROR } from '../../lib/constants';
import {
  ALL_CLUBS,
  buildChips,
  buildDashboardRows,
  headerScope,
  inScope,
  needAFourthAlerts,
} from '../../lib/dashboard';
import type { DashboardRow, FourthAlert } from '../../lib/dashboard';
import { fetchUpcomingEvents, formatEventTime, formatFeeCents, formatEventWhen } from '../../lib/events';
import type { ClubEvent } from '../../lib/events';
import { useSession } from '../../lib/session';
import { colors, radius, space, type } from '../../lib/theme';
import { useUnreadCounts } from '../../lib/use-unread';

/**
 * The waitlist half of a `commit_booking` outcome, worded as the event screen
 * words it (`waitlistLabel`) and naming the game it is about. A waitlisted
 * outcome can carry a null `waitlist_position` — the same "waiting, position
 * unknown" case the row's own seat status already words as "Waiting for a
 * seat".
 *
 * `description` is not optional. The seated notice has always named its game
 * ("You're in — Thu 4 Sep, 7:00 pm — Club Night") while this one said only
 * "2nd on the waitlist", which on a dashboard listing several games named
 * none of them. Requiring the argument is what stops the two halves drifting
 * apart again.
 */
function waitlistNotice(
  result: BookingOutcome | null,
  description: string,
): string | null {
  if (!result || result.outcome !== 'waitlisted') return null;
  const position =
    result.waitlist_position !== null
      ? waitlistLabel(result.waitlist_position)
      : 'Waiting for a seat';
  return `${position} — ${description}`;
}

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
  // The viewer's own role in every club they belong to, used only to
  // compute which clubs they organize (see `organizerClubIds` below).
  // Deliberately NOT paired with a `rolesFailed` boolean the way
  // `bookings`/`bookingsFailed` are: a failed or empty read both resolve to
  // "no organizing rows" with no error banner, so there is nothing a
  // separate failed-state would let this screen say differently.
  const [roles, setRoles] = useState<{ club_id: string; role: ClubRole }[]>([]);
  // One flag for every booking write — take, join, decline, accept-offer,
  // decline-offer, leave-waitlist — held across the write AND its reload,
  // not just the write. These used to be two independent flags (`takeBusy`
  // and `actionBusy`), so a decline could start while a join was still in
  // flight and the two reloadAfterBooking calls would race to set `events`
  // and `bookings`, with the loser's stale read winning. Merging them into
  // one flag closed that write-vs-write window, but an earlier version of
  // this fix released the flag right after the write's own await — before
  // `await reloadAfterBooking()` — which left a write-vs-reload window open
  // instead: `reloadAfterBooking` is the half that actually writes `events`
  // and `bookings`, so a decline's reload could still land after a later
  // join's reload and overwrite it with a snapshot taken before the join
  // existed. The flag now stays true until that reload finishes too.
  //
  // `checkInBusy` stays separate on purpose: the check-in control writes
  // optimistically, for one person, and deliberately does not wait on the
  // server — gating it on the same flag would make a two-state toggle feel
  // like a form submission.
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkInBusy, setCheckInBusy] = useState(false);
  // `busy` above is read from the render closure, so a guard written as
  // `if (busy) return` is blind to a tap landing in the same tick as an
  // earlier `setBusy(true)` — a queued tap, a screen reader activation, a
  // native double-tap — since the closure still holds the old value in that
  // window. And once the re-render does land, `Pressable`'s own `disabled`
  // prop already swallows the press, so the state check adds nothing there
  // either. This ref is written synchronously alongside `setBusy`, so it is
  // what actually makes the guard sound; `busy` itself keeps doing its own
  // job of re-rendering the buttons into their disabled look.
  const busyRef = useRef(false);

  const [events, setEvents] = useState<ClubEvent[]>([]);
  const [selected, setSelected] = useState<string>(ALL_CLUBS);
  const [notice, setNotice] = useState<string | null>(null);
  const { byClub: unreadByClub } = useUnreadCounts();
  const [displayName, setDisplayName] = useState('');
  const [greetings, setGreetings] = useState<Greeting[]>([]);

  // Every write below awaits the network and then calls setState. Nothing
  // checked the screen was still mounted, so navigating away mid-write —
  // now a single tap, since the rows opened up — set state on an unmounted
  // component. Set to true on mount rather than relying on the initial
  // value: under StrictMode the effect runs, cleans up, and runs again, and
  // a ref initialised once would stay false through the second mount.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
      const perClub = await fetchEventsForClubs(result);
      if (cancelled) return;
      setEvents(perClub);
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
    fetchMyRoles(userId).then((result) => {
      if (cancelled) return;
      setRoles(result ?? []);
    });
    fetchProfile(userId).then((result) => {
      if (cancelled) return;
      if (result) setDisplayName(result.display_name);
    });
    fetchGreetings().then((result) => {
      if (cancelled) return;
      setGreetings(result ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // One read per club. Chatty by design for now — collapsing these into a
  // single RPC is deferred item 8 in the spec, and wants the screen's shape
  // to settle first. Failures degrade to "no open games" rather than
  // blanking the screen: the member's own bookings are the load-bearing
  // half and they came from a different call.
  //
  // Shared by the mount effect and by the refresh after a successful take or
  // join, so the two paths cannot drift. Returns rather than setting state
  // itself: the mount path has to drop a result that arrived after its effect
  // was cancelled, which a self-setting helper could not see.
  async function fetchEventsForClubs(list: Club[]): Promise<ClubEvent[]> {
    const perClub = await Promise.all(
      list.map((club) => fetchUpcomingEvents(club.id)),
    );
    return perClub.filter((events): events is ClubEvent[] => events !== null).flat();
  }

  async function reloadBookings() {
    const result = await fetchMyUpcomingBookings();
    if (!mounted.current) return;
    if (result === null) setBookingsFailed(true);
    else {
      setBookings(result);
      setBookingsFailed(false);
    }
  }

  // Same shape as the event screen's own `run` helper: render the data
  // layer's refusal verbatim (never a generic "check your connection"),
  // and only reload once the write actually succeeded.
  //
  // `reloadAfterBooking`, not `reloadBookings`: every action routed through
  // here — decline, leave-waitlist, accept-offer, decline-offer — changes the
  // seats on the event too, and the alerts and joinable rows are derived from
  // `events`. Reloading only the bookings left a member who had just left a
  // waitlist still counted as `waitlisted` by `viewerIsIn`, so the seat they
  // had freed produced neither a Join row nor a "Need a 4th" card until the
  // screen remounted. The notice goes with it for the same reason: a standing
  // "2nd on the waitlist" banner describes a waitlist spot this action may
  // have just given up.
  async function runBookingAction(action: () => Promise<{ error: string | null }>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const { error } = await action();
    if (!mounted.current) return;
    if (error) {
      busyRef.current = false;
      setBusy(false);
      setActionError(error);
      return;
    }
    await reloadAfterBooking();
    if (!mounted.current) return;
    busyRef.current = false;
    setBusy(false);
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
    if (!mounted.current) return;
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

  // Both halves of the screen move after a successful booking write, so both
  // are re-read. The alerts and the joinable rows are derived from `events`,
  // not from `bookings`: reloading only the bookings left the need-a-fourth
  // card the member had just acted on still on screen, with a live "I'm in"
  // button whose only possible outcome was the
  // `bookings_one_active_per_person_idx` refusal.
  async function reloadAfterBooking() {
    const [, freshEvents] = await Promise.all([
      reloadBookings(),
      fetchEventsForClubs(clubs ?? []),
    ]);
    if (!mounted.current) return;
    setEvents(freshEvents);
  }

  // Taking the advertised seat: `preferredTableId` is the very table the
  // alert counted as one short, so the member lands with the three people
  // they were shown rather than wherever the server happens to have room.
  async function takeSeat(alert: FourthAlert) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    // Any standing confirmation describes an earlier action. Leaving it up
    // while this one runs — or after it fails — makes a claim the screen can
    // no longer stand behind.
    setNotice(null);
    const { result, error } = await commitBooking({
      eventId: alert.eventId,
      players: [userId ?? ''],
      preferredTableId: alert.tableId,
      allowSplit: false,
    });
    if (!mounted.current) return;
    if (error) {
      busyRef.current = false;
      setBusy(false);
      setActionError(error);
      return;
    }
    // Told from this attempt's own result, the way the event screen's
    // `bookSeat` already does it: this card advertises ONE seat to every
    // eligible member at once, so `commit_booking` answering `error: null`
    // with `outcome: 'waitlisted'` — someone else got there first — is an
    // ordinary outcome, not a rare race, and must not be reported as
    // "You're in".
    setNotice(waitlistNotice(result, alert.text) ?? `You're in — ${alert.text}.`);
    await reloadAfterBooking();
    if (!mounted.current) return;
    busyRef.current = false;
    setBusy(false);
  }

  // The same call with no table preference. A seated join raises no notice —
  // the row flipping from Join to Seated is its own confirmation — but a
  // waitlisted one still has to say so, for the same reason as above:
  // nothing else on the screen would tell the member the game filled up
  // between the render and the tap.
  async function joinGame(row: DashboardRow) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setActionError(null);
    setNotice(null);
    const { result, error } = await commitBooking({
      eventId: row.eventId,
      players: [userId ?? ''],
      preferredTableId: null,
      allowSplit: false,
    });
    if (!mounted.current) return;
    if (error) {
      busyRef.current = false;
      setBusy(false);
      setActionError(error);
      return;
    }
    // Built the way the alert builds its own `text`, so both notices read
    // alike whichever button raised them.
    const description = `${formatEventWhen(row.startsAt, row.timezone)} — ${row.title}`;
    setNotice(waitlistNotice(result, description));
    await reloadAfterBooking();
    if (!mounted.current) return;
    busyRef.current = false;
    setBusy(false);
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
        <View style={styles.titleRow}>
          <View testID="section-tile">
            <MahjongTile suit="dots" size="section" />
          </View>
          <Text style={styles.heading}>Your clubs</Text>
        </View>
        <ErrorBanner message={GENERIC_ERROR} />
      </Screen>
    );
  }

  const list = clubs ?? [];

  // A member in no clubs has no clubs to filter, no games to list, and one
  // thing to do. Returning early says that, instead of walking them past an
  // empty "Your games" to reach it.
  if (list.length === 0) {
    const empty = headerScope(list, ALL_CLUBS);
    return (
      <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <DashboardHeader
          kicker={empty.kicker}
          name={empty.name}
          meta={empty.meta}
          titleAccessory={
            <View testID="section-tile">
              <MahjongTile suit="dots" size="section" />
            </View>
          }
        />
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
      </Screen>
    );
  }

  const scope = headerScope(list, selected);
  const organizerClubIds = new Set(
    roles.filter((r) => canInvite(r.role)).map((r) => r.club_id),
  );
  const rows = buildDashboardRows({
    bookings: bookings ?? [],
    events,
    clubs: list,
    userId: userId ?? '',
    organizerClubIds,
  }).filter((row) => inScope(row.clubId, selected));
  const alerts = needAFourthAlerts({
    events,
    clubs: list,
    userId: userId ?? '',
  }).filter((alert) => inScope(alert.clubId, selected));

  // The club in scope — what "Host a table" and the header's own "Add a
  // game" create in, and what the header's pencil opens. Derived from the
  // clubs themselves, NOT from the chip state: a one-club member's
  // `selected` stays ALL_CLUBS unless they redundantly tap their own tile,
  // and gating on `selected !== ALL_CLUBS` alone would hide every one of
  // these affordances from exactly the member most likely to want them.
  // With several clubs and no chip picked the scope genuinely is ambiguous,
  // so none of them is offered rather than one that guesses. `headerScope`
  // resolves the lone club the same way, for the same reason. The lookup
  // below also guards against a `selected` that no longer names a club in
  // `list` — the same "left, removed, or the list reloaded" case
  // `headerScope` (lib/dashboard.ts) validates against, for the same reason:
  // trusting `selected` blindly would let the header read the all-clubs
  // scope while still pushing a route built from a stale, non-existent id.
  const scopeClubId =
    list.find((club) => club.id === selected)?.id ??
    (list.length === 1 ? list[0].id : null);

  const todaysGreeting = pickDailyGreeting(greetings, new Date());
  const greetingText = todaysGreeting
    ? applyGreetingTemplate(todaysGreeting.text, displayName)
    : null;
  // Only on the flat "all clubs" scope — a single club's own dashboard
  // (whether reached by a one-club member, who resolves there by default
  // per headerScope, or by filtering into one) has its own identity to
  // show instead, and a generic dashboard greeting has nothing to do with
  // the specific club in view.
  const showGreeting = greetingText !== null && scope.kicker !== 'Your club';

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      {showGreeting ? <Text style={styles.greeting}>{greetingText}</Text> : null}
      {scope.kicker === 'Your club' ? (
        <DashboardHeader
          kicker={scope.kicker}
          name={scope.name}
          meta={scope.meta}
          clubId={scopeClubId ?? undefined}
          onPressScope={
            scopeClubId ? () => router.push(`/clubs/${scopeClubId}`) : undefined
          }
          // Same club the pencil opens — a member looking at one club's games
          // reaches for the header's + expecting "add a game here", not
          // "start an unrelated club". `scopeClubId` already resolves both the
          // ways a single club ends up in view: an explicit chip pick, and a
          // one-club member's own club, which `headerScope` shows regardless
          // of `selected` — so this covers both with no special-casing.
          onPressAddGame={
            scopeClubId ? () => router.push(`/clubs/${scopeClubId}/events/new`) : undefined
          }
          // Shown exactly when the chip row is hidden (see the row's own
          // guard below) — the chevron is the way back once a club is
          // filtered in, whether that happened at two clubs or a member
          // redundantly tapped their own single tile.
          onPressBack={
            selected !== ALL_CLUBS
              ? () => {
                  setSelected(ALL_CLUBS);
                  setNotice(null);
                }
              : undefined
          }
        />
      ) : null}

      {/*
        Shown whenever nothing REAL is filtered in — the ALL_CLUBS default,
        and also a `selected` that no longer names a club in `list` (left,
        removed, or the list reloaded), the same stale-id case `scopeClubId`
        and `headerScope` (lib/dashboard.ts) both guard against. That keeps
        the row (and its trailing "New club" tile, where starting another
        club lives now, not the header) from vanishing outright in that
        state — it recovers instead, the same way the old `list.length > 1`
        guard this replaced would have. Hidden the moment a REAL club is
        filtered in, at any club count: the header's back chevron is the way
        to see this row again, so there is no dead end even for a one-club
        member who taps their own tile.
      */}
      {list.some((club) => club.id === selected) ? null : (
        <ClubChips
          chips={buildChips(list)}
          selected={selected}
          unreadByClub={unreadByClub}
          // A confirmation raised for a game at one club is not an answer to
          // "show me a different club" — the notice would otherwise sit above
          // content it has nothing to do with.
          onSelect={(id) => {
            setSelected(id);
            setNotice(null);
          }}
          onPressNewClub={() => router.push('/clubs/new')}
        />
      )}

      {notice ? (
        <NoticeBanner message={notice} onDismiss={() => setNotice(null)} />
      ) : null}

      {actionError ? <ErrorBanner message={actionError} /> : null}

      {alerts.map((alert) => (
        <NeedAFourthCard
          key={`${alert.eventId}:${alert.tableId}`}
          clubName={alert.clubName}
          text={alert.text}
          busy={busy}
          onTake={() => void takeSeat(alert)}
        />
      ))}

      {bookingsFailed ? (
        <Text style={styles.help}>Could not load your games.</Text>
      ) : rows.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.help}>Nothing else coming up.</Text>
          {scopeClubId ? (
            <Button
              variant="secondary"
              big={false}
              onPress={() => router.push(`/clubs/${scopeClubId}/events/new`)}
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
            busy={busy}
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
    </Screen>
  );
}

/**
 * One row of "Your games": the artboard's date tile, the club and title, and
 * a single right-hand affordance — Join for an open game the member is not
 * in yet, "Seated" for one they hold, "Hosting" for an in-progress game they
 * organize but have not booked (`row.organizing` — see buildDashboardRows'
 * own doc comment in lib/dashboard.ts).
 *
 * A joinable row carries no booking, so none of the seat-management controls
 * apply to it; everything they need lives in `BookingSeatControls` below,
 * rendered only when `row.booking` is there.
 */
function GameRow({
  row,
  youId,
  busy,
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
        {/*
          Pressable rather than the Card itself, and the trailing controls
          left outside it: a row can carry a Join button, a Seated tag, offer
          accept/decline, leave-waitlist and a check-in control, and a
          card-wide press target would sit under all of them. Pressable
          rather than Card under `asChild` as well — Card neither declares
          accessibility props nor spreads unrecognised ones onto its View, so
          cloning onto it drops the handler Link injects. The club cards that
          used to carry this same explanation are gone (the chip row is the
          club list now), which leaves this the only `asChild` site on the
          screen and this comment the only place the reasoning lives.

          Worth recording, then, what that `asChild` merge actually
          produces on the web: it does not wrap this Pressable in an <a> the
          way the JSX nesting implies. useLinkToPathProps merges `href`,
          `onPress`, and a raw `role: 'link'` straight onto the child through
          a Radix Slot, and react-native-web's propsToAriaRole resolves that
          injected `role` ahead of this element's own `accessibilityRole`.
          With `href` present, View also switches its host element to <a>.
          So the web build ends up rendering one `<a href role="link">`, not
          the `<div role="button">` the `accessibilityRole` below might
          suggest — that prop is what the native accessibility tree sees,
          not the DOM the browser actually gets.
        */}
        <Link href={`/clubs/${row.clubId}/events/${row.eventId}`} asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${row.title}`}
            style={styles.gameOpen}
          >
            <DateTile startsAt={row.startsAt} timezone={row.timezone} />
            <View style={styles.gameBody}>
              <Text style={styles.gameClubName} numberOfLines={1}>
                {row.clubName}
              </Text>
              <Text style={styles.gameTime}>
                {formatEventTime(row.startsAt, row.timezone)}
              </Text>
              <Text style={styles.gameVenue}>{row.venueName}</Text>
              {row.feeCents > 0 || row.minSpendCents > 0 ? (
                <Text style={styles.gameFee}>
                  {[
                    row.feeCents > 0 ? `${formatFeeCents(row.feeCents)} to play` : null,
                    row.minSpendCents > 0
                      ? `${formatFeeCents(row.minSpendCents)} min spend`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Link>
        {/*
          Absolutely positioned, not a flex sibling of `gameOpen` -- a flex
          row reserves this column's width for the sibling's FULL height,
          not just the one line the badge/button actually occupies, which
          was squeezing gameBody's later lines (the fee line especially)
          into an unnecessary wrap with visibly empty space beside them
          (confirmed live). Taking it out of flow lets gameBody use the
          card's full width; only the top-right corner, where the club
          name/time already sit well clear of it in practice, is spoken
          for.
        */}
        <View style={styles.gameTrailing}>
          {booking === null ? (
            row.organizing ? (
              <Tag variant="accent">Hosting</Tag>
            ) : (
              <Button
                variant="secondary"
                big={false}
                disabled={busy}
                onPress={() => onJoin(row)}
                accessibilityLabel={`Join ${row.title}`}
                style={styles.gameAction}
              >
                Join
              </Button>
            )
          ) : booking.status === 'confirmed' ? (
            // The table used to render as its own separate line below the
            // tag, then as a second line under it (both tried and
            // confirmed misaligned live) -- one message, one pill: the
            // table is part of what "Seated" means, not a footnote next
            // to it.
            <Tag variant="accent2">
              {booking.table_label ? `Seated · ${booking.table_label}` : 'Seated'}
            </Tag>
          ) : null}
        </View>
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
  // moment, merely "waiting" for one. A seated member's table now renders
  // next to the row's own "Seated" tag instead (GameRow) — nothing left
  // for this line to say once a table is assigned, so it renders nothing
  // rather than repeating the same label a second time.
  const seatStatus = hasOffer || booking.table_label
    ? null
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
    // clubs" and the content below it sat flush with the viewport edge. See
    // the "no page padding" item in todo.md.
    padding: space[6],
    gap: space[4],
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  greeting: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  // Used only by the `loadFailed` branch. The other two places this screen
  // could show a section tile don't need a row of their own for it: the
  // empty-clubs-list branch passes it as `DashboardHeader`'s own
  // `titleAccessory` (rendered inline, before the name, by that component
  // itself), and the main populated branch's flat "all clubs" scope has no
  // header -- and so no section tile -- at all, removed entirely once the
  // chip row took over as that scope's own heading. Only the plain
  // `<Text style={styles.heading}>` branch below has no wrapping row of its
  // own to sit a tile beside, hence this one.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  // The empty state's own gap: what puts space between the "not in a club
  // yet" help text and the "Start a club" button below it, instead of them
  // rendering as adjacent siblings with nothing between them. The skeleton
  // stack uses it too. It was the club list's gap before that list folded
  // into the chip row — see the "no space between the last club and the
  // button" item in todo.md for what it originally fixed.
  list: {
    gap: space[3],
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
  // `position: relative` is the anchor `gameTrailing`'s absolute
  // positioning below is relative to -- see that style's own comment for
  // why the trailing badge/button lives outside the normal flex flow now.
  gameRow: {
    position: 'relative',
  },
  gameBody: {
    flex: 1,
    minWidth: 0,
  },
  gameOpen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  gameTrailing: {
    position: 'absolute',
    top: 0,
    right: 0,
  },
  gameClubName: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.textMuted,
    // A club name long enough to reach the trailing badge/button's corner
    // truncates instead of running under it -- the other lines below (time,
    // venue, fee) have the full card width to themselves and don't need this.
    paddingRight: space[3],
  },
  gameTime: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: 1,
  },
  gameVenue: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 1,
  },
  gameFee: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    marginTop: 1,
  },
  gameAction: {
    flexShrink: 0,
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
