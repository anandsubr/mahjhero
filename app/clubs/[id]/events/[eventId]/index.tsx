import { Link, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import BringSomeoneSheet from '../../../../../components/BringSomeoneSheet';
import Button from '../../../../../components/Button';
import Card from '../../../../../components/Card';
import ErrorBanner from '../../../../../components/ErrorBanner';
import Screen from '../../../../../components/Screen';
import Tag from '../../../../../components/Tag';
import TableCard from '../../../../../components/TableCard';
import TierPicker from '../../../../../components/TierPicker';
import WaitlistPanel from '../../../../../components/WaitlistPanel';
import { ChevronLeftIcon } from '../../../../../components/icons';
import { canInvite, fetchClub, fetchRoster } from '../../../../../lib/clubs';
import type { Club, ClubMember } from '../../../../../lib/clubs';
import {
  acceptPromotionOffer,
  callForAFourth,
  cancelBooking,
  commitBooking,
  declinePromotionOffer,
  fetchEventSeating,
  fetchOpenOffer,
  needsAFourth,
  placeBooking,
  proposeBooking,
  seatsRemaining,
  tierWarning,
  waitlistLabel,
  type SeatOccupant,
  type SkillLevel,
} from '../../../../../lib/bookings';
import {
  addEventTable,
  cancelEvent,
  fetchEvent,
  fetchEventTables,
  fetchSeries,
  formatEventWhen,
  frequencyLabel,
  removeEventTable,
  resetEventToSeries,
  updateEventTable,
  type ClubEvent,
  type EventSeries,
  type EventTable,
} from '../../../../../lib/events';
import { useSession } from '../../../../../lib/session';
import { colors, space, type } from '../../../../../lib/theme';

/**
 * The member-facing view of one game. What a member sees: the time and
 * venue (in the club's own timezone, never the device's), any notes, every
 * table with its tier and who is seated at it, and — for a game that is
 * still `published` and in the future — a tap-to-book empty seat at each
 * table, plus a waitlist panel once the game is full. A cancelled or
 * already-started game gets no `onTakeSeat` at all (see `canBook` below):
 * no disabled control that errors when pressed, just nothing to press.
 *
 * Organizers (host or co-organizer — `canInvite`, the same test the SQL
 * functions below enforce) additionally get table management and seating
 * controls: `TierPicker` and Remove table rendered into `TableCard`'s
 * `children` slot, "Call for a 4th now" (also in `children`, computed by
 * `canCallForAFourth` below), and — inside `TableCard`'s own `SeatGrid` —
 * tapping an occupied seat reveals THAT person's actions (move to another
 * table, or remove them from the game entirely) instead of everyone's at
 * once. `openBookingId` below is what keeps only one such panel open across
 * the whole screen, since every table renders its own SeatGrid instance.
 * This replaces the old `HostSeating` component, which listed every
 * occupant of a table with a "Move to …" button per OTHER table plus
 * "Remove from game" attached to each row — the seat grid directly above it
 * already named everyone, so that list was a second copy of the same
 * people with buttons attached (see
 * .superpowers/sdd/seat-tap-host-controls.md). One level down, in
 * `WaitlistPanel`'s "Coming, not yet seated" section, a host still gets a
 * "Seat at …" option per table for anyone confirmed but not yet placed — a
 * seat tap can't reach somebody who has no seat. There is deliberately no
 * "Unseat" control: a host who wants somebody off a table moves them
 * elsewhere or removes them from the game, never parks them in limbo on
 * purpose. Also: an edit link (Task 15), a cancel action, and — only on a
 * series occurrence they have personally customised — a "Reset to the
 * series" control.
 */
export default function EventScreen() {
  const { id: clubId, eventId } = useLocalSearchParams<{
    id: string;
    eventId: string;
  }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [event, setEvent] = useState<ClubEvent | null>(null);
  const [tables, setTables] = useState<EventTable[]>([]);
  // Separate from the "essential data missing" case below, on purpose. The
  // club detail screen (Task 12) originally conflated "the tables fetch
  // failed" with "this game has zero tables" by defaulting straight to `[]`
  // — a member would read a failed load as an empty, table-less game rather
  // than a screen that could not load. Club and event ARE essential (there
  // is nothing to show without them); the table list is a section that can
  // fail on its own while the rest of the screen still renders correctly.
  const [tablesFailed, setTablesFailed] = useState(false);
  const [series, setSeries] = useState<EventSeries | null>(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [mySkillLevel, setMySkillLevel] = useState<SkillLevel | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Who is coming: every live (confirmed or waitlisted) booking, plus
  // whether the fetch itself failed. Kept separate from `tablesFailed` for
  // the same reason that one is separate from the essential-data guard
  // below: the tables can load fine while the guest list fails, or vice
  // versa, and each failure should only blank its own section.
  const [seating, setSeating] = useState<SeatOccupant[]>([]);
  const [seatingFailed, setSeatingFailed] = useState(false);

  // The roster BringSomeoneSheet's picker offers, kept separate from the
  // organizer-only `isOrganizer`/`mySkillLevel` derivation the roster fetch
  // already fed below. `rosterFailed` matters for the same reason
  // `tablesFailed`/`seatingFailed` do: a failed fetch and a genuinely empty
  // roster must not read the same way. Reading a failure as "you have nobody
  // to bring" would be a false statement, not just a missing feature — so the
  // sheet's entry points are hidden on failure rather than opened onto an
  // empty picker.
  const [roster, setRoster] = useState<ClubMember[]>([]);
  const [rosterFailed, setRosterFailed] = useState(false);

  // Whether BringSomeoneSheet is open. There used to be a per-table entry
  // point too (see the git history around this file, and TableCard's own
  // docstring), which meant this tracked *which* table the sheet was open
  // for. The human decided to keep only this screen-level "Bring someone" —
  // the sheet already asks "Where?" with every table plus "Any table", so a
  // per-table button only pre-selected a chip the member could change in
  // the next breath, and those buttons vanished one by one as tables filled
  // with no explanation. A plain boolean is what is left once there is only
  // one place this can be opened from.
  const [isBringingSomeone, setIsBringingSomeone] = useState(false);

  // A promotion offer currently held open for this member's group, read via
  // `fetchOpenOffer`. RLS (`promotion_offers_select_group`) already scopes
  // the fetch to a group this member actually belongs to, so no client-side
  // filtering on `youId`/`group_id` is needed here. Reshaped from
  // `PromotionOffer` (`offered_seat_count`) to `WaitlistPanel`'s prop shape
  // (`seats`) below, in `load()`.
  const [offer, setOffer] = useState<{
    id: string;
    seats: number;
    expires_at: string;
  } | null>(null);

  // The soft tier warning, held pending a "Book anyway?" confirm. This is
  // the entire enforcement of skill tiers in this product — the database
  // does not check, and the host can move people afterwards.
  const [pendingTier, setPendingTier] = useState<{
    tableId: string;
    message: string;
  } | null>(null);

  // Immediate feedback from the member's own most recent booking attempt,
  // shown alongside (not instead of) the reloaded seating/WaitlistPanel
  // state — the reload is what stays correct as other people book, but a
  // member who just tapped a seat and landed on the waitlist should not
  // have to find their own position in a list to learn where they stand.
  const [waitlistNote, setWaitlistNote] = useState<string | null>(null);

  // Which seated booking's seat-tap panel (Move / Remove) is open. Deliberately
  // NOT owned by TableCard or SeatGrid: this screen renders one SeatGrid
  // instance per table, and "only one person's panel open at a time" is a
  // whole-screen rule, not a per-table one — so the one piece of state that
  // enforces it has to live above every table, the same reason `busy` does.
  const [openBookingId, setOpenBookingId] = useState<string | null>(null);

  const me = session?.user.id ?? '';

  async function load() {
    const [loadedClub, loadedEvent, loadedTables, rosterRows, seatingRows, openOffer] =
      await Promise.all([
        fetchClub(clubId),
        fetchEvent(eventId),
        fetchEventTables(eventId),
        fetchRoster(clubId),
        fetchEventSeating(eventId),
        fetchOpenOffer(eventId),
      ]);

    setClub(loadedClub);
    setEvent(loadedEvent);
    setTablesFailed(loadedTables === null);
    setTables(loadedTables ?? []);

    // A failed fetch is not an empty game: `fetchEventSeating` returns
    // `null` on failure and `[]` when nobody has booked yet. Reading the
    // first as the second is exactly the bug `venuesFailed` exists to
    // avoid on the venues screen (todo.md still records that screen
    // getting it wrong) — this game's guest list gets the same treatment.
    setSeatingFailed(seatingRows === null);
    setSeating(seatingRows ?? []);

    // `fetchOpenOffer` returns null both on failure and on "no open offer" —
    // unlike seating there is no third failed-vs-empty state to preserve
    // here: an offer that failed to load is indistinguishable from one that
    // doesn't exist, and in both cases the banner should simply not render.
    setOffer(
      openOffer
        ? {
            id: openOffer.id,
            seats: openOffer.offered_seat_count,
            expires_at: openOffer.expires_at,
          }
        : null,
    );

    // A roster fetch failure fails closed to "not an organizer" rather than
    // blanking the screen — the member-facing content above is unaffected,
    // and the worst case is a host who temporarily loses their controls
    // rather than a page that cannot render at all.
    const myRole = (rosterRows ?? []).find(
      (m) => m.profile_id === session?.user.id,
    );
    setIsOrganizer(myRole ? canInvite(myRole.role) : false);
    setMySkillLevel(myRole?.skill_level ?? null);

    setRosterFailed(rosterRows === null);
    setRoster(rosterRows ?? []);

    setSeries(
      loadedEvent?.series_id ? await fetchSeries(loadedEvent.series_id) : null,
    );
    setReady(true);
  }

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    load().catch(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubId, eventId, session]);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  // Checked before the `!ready` guard below, deliberately: `ready` is only
  // ever set inside the effect above, which returns immediately when there
  // is no session. A signed-out visitor can never make `ready` true, so
  // checking `!ready` first would spin forever instead of sending them to
  // sign in — the same guard-ordering defect already fixed on the club
  // detail screen and the create-game screen (and present in this task's
  // own brief's sample code, which put this check after the `!ready` one).
  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!club || !event) {
    return (
      <Screen contentStyle={styles.container}>
        <ErrorBanner message="That game could not be loaded." />
      </Screen>
    );
  }

  const overridden = (key: string) => event.overrides.includes(key as never);

  // `reset_event_to_series` refuses a cancelled occurrence and one whose
  // `starts_at` is already in the past (see
  // supabase/migrations/20260823050000_reset_event_to_series_past_guard.sql)
  // — history is not rewritten, and a cancelled week has nothing left to
  // reset onto. The control is hidden rather than shown-and-erroring for
  // either case, so an organizer never taps a button the database is only
  // going to refuse. Comparing `starts_at` (an instant) against `Date.now()`
  // (also an instant) is not a timezone conversion — both sides are UTC
  // epoch milliseconds regardless of the runtime's local zone, so this stays
  // correct under any TZ the app happens to run in.
  const canReset =
    isOrganizer &&
    // Belt-and-suspenders alongside the length check below: nothing in the
    // schema forbids a one-off event's `overrides` from being non-empty (the
    // check constraint only restricts which keys may appear, not that they
    // require a series), and only a series occurrence has anything to reset
    // "back" to. The brief is explicit that a one-off event must never show
    // this control.
    event.series_id !== null &&
    event.overrides.length > 0 &&
    event.status !== 'cancelled' &&
    new Date(event.starts_at).getTime() > Date.now();

  async function run(action: () => Promise<{ error: string | null }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    await load();
  }

  // One instant, shared by `canBook` and every table's `needsAFourth` call
  // below, so a table's "needs a 4th" state and the screen's own bookable
  // gate never disagree about what "now" means within a single render.
  const now = new Date();

  const canBook = event.status === 'published' && new Date(event.starts_at) > now;

  // Every table full, counting only bookings actually placed at one — a
  // booking still awaiting placement (`event_table_id === null`) occupies a
  // seat somewhere but isn't blocking any *specific* table from showing an
  // empty one, so it is deliberately excluded from this per-table count.
  const gameFull =
    !tablesFailed &&
    tables.length > 0 &&
    tables.every((t) => {
      const confirmedHere = seating.filter(
        (o) => o.status === 'confirmed' && o.event_table_id === t.id,
      ).length;
      return seatsRemaining(t.capacity, confirmedHere) === 0;
    });

  // This member's own live booking, if any — the thing a seat tap now needs
  // to route on. `myHoldsSeat` below is just this narrowed to a boolean;
  // kept as a separate name because most call sites only ever care whether
  // one exists, not which table it's at or what status it's in.
  const myBooking = seating.find(
    (o) => o.profile_id === me && (o.status === 'confirmed' || o.status === 'waitlisted'),
  );
  const myHoldsSeat = myBooking !== undefined;

  // Confirmed but not placed at any table — "any table" bookings, and
  // whatever `placeBooking(id, null)` produces (the data-layer capability
  // behind the seating rule still stands; there is just no UI button left
  // that calls it with `null` — see `hostPlace`'s own comment below).
  // Rendered exactly ONCE, in WaitlistPanel's "Coming, not yet seated"
  // section — not per table card. This used to be handed to every table's
  // own HostSeating too, so a single unplaced member showed up under Table
  // 1 AND Table 2 AND Table 3, reading as "unseated and still at the
  // table" everywhere a host could place them. HostSeating is gone
  // entirely now (folded into SeatGrid's own seat-tap panel, which can only
  // ever reach a booking that already has a seat) — this list is still the
  // one and only place an unplaced booking is ever offered a table.
  const unseatedBookings = seating.filter(
    (o) => o.status === 'confirmed' && o.event_table_id === null,
  );

  // Gates both BringSomeoneSheet entry points (TableCard's per-table one and
  // the screen-level "any table" one below). `canBook` matches `onTakeSeat`'s
  // own guard (no booking action on a cancelled/started game). `!rosterFailed`
  // is this sheet's own: a roster that failed to load would open the sheet
  // onto a picker with nobody in it, reading as "you have no one to bring"
  // rather than as the fetch failure it actually is.
  //
  // This used to also require `!myHoldsSeat` -- on the theory that
  // BringSomeoneSheet always seats the opener as its first player, so an
  // already-seated member would meet a guaranteed "already booked" refusal.
  // That was true, but the fix belonged in the sheet, not here: an
  // already-seated member bringing a friend ("I'm in, and Jane wants to
  // come too") is plausibly the commonest use of this feature, and hiding
  // the entry point for it entirely -- with no error explaining why the
  // button just isn't there -- was the wrong remedy for a shape problem in
  // BringSomeoneSheet's player list. The sheet now omits "You" and seeds no
  // seat for an opener already in `booked`, so this gate no longer needs
  // `myHoldsSeat` at all.
  const canBringSomeone = canBook && !rosterFailed;

  async function bookSeat(tableId: string | null) {
    setPendingTier(null);
    setBusy(true);
    setError(null);
    const { result, error: bookingError } = await commitBooking({
      eventId,
      players: [me],
      preferredTableId: tableId,
      allowSplit: true,
    });
    setBusy(false);
    if (bookingError) {
      setError(bookingError);
      return;
    }
    // Told directly from this attempt's own result, not read back off the
    // reload below: a real reload would eventually show the same thing via
    // `WaitlistPanel`, but a member who just tapped a seat should not have
    // to go find themselves in a list to learn where they landed.
    setWaitlistNote(
      result && result.outcome === 'waitlisted' && result.waitlist_position !== null
        ? waitlistLabel(result.waitlist_position)
        : null,
    );
    await load();
  }

  // Moves an already-confirmed booking onto a different table via
  // `place_booking` — the RPC that already permits a member to move their
  // own booking, and already refuses a full table, a non-confirmed booking,
  // and a started game. Mirrors `bookSeat`'s own shape (clear any pending
  // warning, go busy, reload on success) but through `placeBooking` rather
  // than `commitBooking`, and with no waitlist outcome to report: a move can
  // only land you at a table, never on the waitlist, so any note left over
  // from an earlier booking attempt is stale and cleared here.
  async function moveSeat(bookingId: string, tableId: string) {
    setPendingTier(null);
    setBusy(true);
    setError(null);
    const { error: moveError } = await placeBooking(bookingId, tableId);
    setBusy(false);
    if (moveError) {
      setError(moveError);
      return;
    }
    setWaitlistNote(null);
    await load();
  }

  // The single place a seat tap's outcome is decided: a fresh booking via
  // `commitBooking` when this member holds nothing yet, or — when they
  // already hold a CONFIRMED booking somewhere (a specific table, or "any
  // table" with a null event_table_id) — a move of that same booking via
  // `placeBooking` instead. `onTakeSeat` below never offers a tap at all
  // for a seat at the table the member already occupies, or for any seat
  // when their booking is only waitlisted (`place_booking` refuses a
  // non-confirmed booking), so by the time this runs the only two live
  // cases are "book" and "move".
  function commitSeat(tableId: string) {
    if (myBooking && myBooking.status === 'confirmed') {
      void moveSeat(myBooking.booking_id, tableId);
      return;
    }
    void bookSeat(tableId);
  }

  function takeSeat(table: EventTable) {
    const warning = tierWarning(table.skill_tier, mySkillLevel, table.label);
    // The soft warning, and the entire enforcement of skill tiers in this
    // product. The database does not check; the host can move people. Applies
    // equally to a move onto a mismatched table — `commitSeat` (called from
    // here directly, and again from the confirm below) is what decides
    // book-vs-move, so the warning gate does not need to know which one is
    // coming.
    if (warning) {
      setPendingTier({ tableId: table.id, message: warning });
      return;
    }
    commitSeat(table.id);
  }

  function joinWaitlist() {
    void bookSeat(null);
  }

  async function leaveWaitlist() {
    const mine = seating.find(
      (o) => o.profile_id === me && o.status === 'waitlisted',
    );
    if (!mine) return;
    await run(() => cancelBooking(mine.booking_id));
  }

  async function acceptOffer() {
    if (!offer) return;
    await run(() => acceptPromotionOffer(offer.id));
  }

  async function declineOffer() {
    if (!offer) return;
    await run(() => declinePromotionOffer(offer.id));
  }

  // The host's own seating controls: SeatGrid's "Move to …" (an occupied
  // seat's own tap panel) and WaitlistPanel's "Seat at …" (for a
  // confirmed-but-unplaced booking) both call this with a real table id.
  // `placeBooking(id, null)` — an Unseat, not a removal; the booking stays
  // confirmed, just without a table — is still what the data layer supports
  // (see placeBooking's own contract), but there is deliberately no button
  // left that calls it: a host who wants somebody off a table moves them
  // elsewhere or removes them from the game via `hostRemove`, which takes
  // somebody out of the game entirely and is not undoable. Parking a member
  // in limbo on purpose was never the goal.
  //
  // Both this and `hostRemove` close whatever seat panel is open first —
  // the action they perform is the reason a panel was open, so leaving it
  // open through the reload would either point at stale data (a moved
  // booking's panel would still be sitting on the table it just left) or,
  // for a remove, at a booking that no longer exists at all.
  async function hostPlace(bookingId: string, tableId: string | null) {
    setOpenBookingId(null);
    await run(() => placeBooking(bookingId, tableId));
  }

  async function hostRemove(bookingId: string) {
    setOpenBookingId(null);
    await run(() => cancelBooking(bookingId));
  }

  // The seat grid's own toggle: tapping an occupied seat opens that
  // person's panel, tapping it again (or tapping any OTHER occupied seat —
  // see `openBookingId` above) closes/replaces it. A plain toggle rather
  // than an always-open would leave no way to collapse a panel without
  // acting on it or opening a different one.
  function toggleManageSeat(bookingId: string) {
    setOpenBookingId((current) => (current === bookingId ? null : bookingId));
  }

  async function hostCallForAFourth(tableId: string) {
    await run(() => callForAFourth(tableId));
  }

  function openBringSomeone() {
    setIsBringingSomeone(true);
  }

  // Reloads even when the sheet is dismissed via "Never mind" rather than a
  // real commit — the reload is a no-op then (nothing changed), and this
  // keeps the seating/table lists correct in the one case that matters
  // (a successful group booking) without the sheet needing to tell its
  // caller which kind of close just happened.
  function closeBringSomeone() {
    setIsBringingSomeone(false);
    void load();
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push(`/clubs/${clubId}`)}
        accessibilityLabel="Back to the club"
        style={styles.backButton}
      >
        {club.name}
      </Button>

      <View style={styles.row}>
        <Text style={styles.heading}>{event.title}</Text>
        {event.status === 'cancelled' ? <Tag>Cancelled</Tag> : null}
      </View>
      {overridden('title') ? (
        <Text style={styles.help}>Renamed for this week</Text>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}

      <Card>
        <Text style={styles.when}>
          {formatEventWhen(event.starts_at, club.timezone)}
        </Text>
        {overridden('starts_at') ? (
          <Text style={styles.help}>Moved from the usual time</Text>
        ) : null}

        <Text style={styles.where}>{event.venue_name}</Text>
        {overridden('venue_id') ? (
          <Text style={styles.help}>Moved from the usual venue</Text>
        ) : null}

        {series ? (
          <Text style={styles.help}>
            Part of a series —{' '}
            {frequencyLabel(series.frequency, series.weekday, series.nth_week)}
          </Text>
        ) : null}
      </Card>

      {/*
        A host who cleared this week's notes has customised them just as
        much as one who added some — `event.notes.length > 0` alone would
        hide the card entirely for that host and never explain why there is
        nothing here, so `overridden('notes')` keeps the card (and its
        explanation) visible even when the text itself is empty.
      */}
      {event.notes.length > 0 || overridden('notes') ? (
        <Card>
          {event.notes.length > 0 ? (
            <Text style={styles.notes}>{event.notes}</Text>
          ) : null}
          {overridden('notes') ? (
            <Text style={styles.help}>Different notes for this week</Text>
          ) : null}
        </Card>
      ) : null}

      <Text style={styles.sectionTitle}>
        {tablesFailed
          ? 'Tables'
          : `${tables.length} ${tables.length === 1 ? 'table' : 'tables'} · ${(() => {
              const seats = tables.reduce((sum, t) => sum + t.capacity, 0);
              return `${seats} ${seats === 1 ? 'seat' : 'seats'}`;
            })()}`}
      </Text>

      {tablesFailed ? (
        <Text style={styles.help}>Could not load the tables for this game.</Text>
      ) : (
        tables.map((table) => {
          const tableOccupants = seating.filter(
            (o) => o.event_table_id === table.id,
          );
          const confirmedAtTable = tableOccupants.filter(
            (o) => o.status === 'confirmed',
          );
          const confirmedHere = confirmedAtTable.length;
          return (
            <TableCard
              key={table.id}
              table={table}
              occupants={tableOccupants}
              youId={me}
              // Omitted entirely — not a disabled control — for a cancelled
              // or already-started game (see `canBook`'s own comment), for
              // every seat once this member's own booking is only
              // waitlisted (`place_booking` refuses a non-confirmed
              // booking, so there is nothing a tap here could do), and for
              // this specific table once a confirmed booking is already
              // seated at it — tapping a seat you already hold has nothing
              // to do. Any other seat — a fresh booking, or a confirmed
              // booking elsewhere (a different table, or "any table")
              // wanting to move — still offers a tap; `takeSeat` (via
              // `commitSeat`) is what decides book vs. move.
              onTakeSeat={
                canBook &&
                (!myBooking ||
                  (myBooking.status === 'confirmed' &&
                    myBooking.event_table_id !== table.id))
                  ? () => takeSeat(table)
                  : undefined
              }
              busy={busy}
              needsFourth={needsAFourth(
                table.capacity,
                confirmedHere,
                new Date(event.starts_at),
                now,
              )}
              // Seat-tap management, forwarded to SeatGrid via TableCard. All
              // five are supplied together for an organizer and omitted
              // together for a member — the seat grid falls back to its
              // plain read-only render (see SeatGrid's own docstring) rather
              // than a half-wired tappable seat with nothing to move to.
              otherTables={
                isOrganizer
                  ? tables
                      .filter((t) => t.id !== table.id)
                      .map((t) => ({ id: t.id, label: t.label }))
                  : undefined
              }
              openBookingId={isOrganizer ? openBookingId : undefined}
              onToggleManage={isOrganizer ? toggleManageSeat : undefined}
              onMove={isOrganizer ? hostPlace : undefined}
              onRemove={isOrganizer ? hostRemove : undefined}
            >
              {isOrganizer ? (
                <>
                  <TierPicker
                    tableLabel={table.label}
                    tier={table.skill_tier}
                    disabled={busy}
                    onChange={(nextTier) =>
                      run(() => updateEventTable(table.id, { tier: nextTier }))
                    }
                  />

                  {tables.length > 1 ? (
                    <Button
                      variant="ghost"
                      big={false}
                      disabled={busy}
                      onPress={() => run(() => removeEventTable(table.id))}
                      accessibilityLabel={`Remove ${table.label}`}
                    >
                      Remove this table
                    </Button>
                  ) : null}

                  {/*
                    canCallForAFourth mirrors need_a_fourth_stage's own
                    occupancy check (20260825050000) minus the 48-hour
                    window — "a host calling early is asking to skip
                    exactly that window", per that migration's own comment.
                    `canBook` already carries the "published and not yet
                    started" half of that rule.

                    `table.capacity >= 2` mirrors `needsAFourth`'s own
                    `capacity < 2` guard (and need_a_fourth_stage's identical
                    `when t.capacity < 2 then null`), which the expression
                    below would otherwise drop: on a capacity-1 table with
                    zero confirmed, `0 === 1 - 1` is true even though such a
                    table can never need a fourth. Not delegated to
                    `needsAFourth` itself, since that function also applies
                    the 48-hour window this gate deliberately skips.

                    Inlined here directly rather than through a component —
                    this used to be HostSeating's one non-per-person control;
                    now that the per-person list it sat below is gone (moved
                    into SeatGrid's own seat-tap panel), a single button
                    doesn't need its own wrapper component.
                  */}
                  {table.capacity >= 2 &&
                  confirmedHere === table.capacity - 1 &&
                  canBook ? (
                    <Button
                      variant="secondary"
                      big={false}
                      disabled={busy}
                      onPress={() => hostCallForAFourth(table.id)}
                      accessibilityLabel={`Call for a fourth at ${table.label}`}
                    >
                      Call for a 4th now
                    </Button>
                  ) : null}
                </>
              ) : null}
            </TableCard>
          );
        })
      )}

      {seatingFailed ? (
        <Text style={styles.help}>
          Could not load who is coming to this game.
        </Text>
      ) : !tablesFailed &&
        seating.filter((o) => o.status === 'confirmed').length === 0 ? (
        <Text style={styles.help}>Nobody has booked yet.</Text>
      ) : null}

      {pendingTier ? (
        <Card>
          <Text style={styles.help}>{pendingTier.message}</Text>
          <View style={styles.chips}>
            <Button
              big={false}
              disabled={busy}
              onPress={() => {
                const tableId = pendingTier.tableId;
                setPendingTier(null);
                commitSeat(tableId);
              }}
              accessibilityLabel="Yes, book me"
            >
              Yes, book me
            </Button>
            <Button
              variant="ghost"
              big={false}
              disabled={busy}
              onPress={() => setPendingTier(null)}
              accessibilityLabel="Never mind"
            >
              Never mind
            </Button>
          </View>
        </Card>
      ) : null}

      {/*
        The only entry point to BringSomeoneSheet. Reachable whenever
        `canBringSomeone` is true, regardless of table occupancy — bringing
        someone when every table is full just means waitlisting the group
        together, which the sheet's own "Any table" + waitlist flow already
        handles (see proposeBooking/commitBooking). There used to also be a
        "Bring someone" button on every TableCard; the human decided to
        remove it, since the sheet already asks "Where?" with every table
        plus "Any table" — a per-table button only pre-selected a chip the
        member could change in the next breath, and those buttons vanished
        one by one, unexplained, as tables filled.
      */}
      {canBringSomeone ? (
        <Button
          variant="secondary"
          disabled={busy}
          onPress={openBringSomeone}
          accessibilityLabel="Bring someone"
        >
          Bring someone
        </Button>
      ) : null}

      {isBringingSomeone ? (
        <BringSomeoneSheet
          roster={roster}
          booked={seating.map((o) => o.profile_id)}
          youId={me}
          tables={tables}
          initialTableId={null}
          onPropose={(input) => proposeBooking({ eventId, ...input })}
          onCommit={(input) => commitBooking({ eventId, ...input })}
          onClose={closeBringSomeone}
        />
      ) : null}

      {canBook && gameFull && !myHoldsSeat ? (
        <Button
          variant="secondary"
          disabled={busy}
          onPress={joinWaitlist}
          accessibilityLabel="Join the waitlist"
        >
          Join the waitlist
        </Button>
      ) : null}

      {waitlistNote ? <Text style={styles.help}>{waitlistNote}</Text> : null}

      {/*
        `tables`/`onSeat` are the one place a host can seat someone who is
        confirmed but unplaced — omitted entirely for a plain member (not
        just disabled), since only a host may place anyone. This is also
        the fix for the duplicate-rendering bug: `unseatedBookings` used to
        be handed to every table's own HostSeating, so one unplaced member
        showed up once per table card. Listing them here, once, with a
        "Seat at …" option per table, is the natural single home —
        WaitlistPanel already had the "Coming, not yet seated" section for
        the member-facing read of the same list.
      */}
      <WaitlistPanel
        unseated={unseatedBookings}
        waiting={seating.filter((o) => o.status === 'waitlisted')}
        youId={me}
        offer={offer}
        now={now}
        busy={busy}
        onAcceptOffer={acceptOffer}
        onDeclineOffer={declineOffer}
        onLeaveWaitlist={leaveWaitlist}
        tables={isOrganizer ? tables : undefined}
        onSeat={isOrganizer ? hostPlace : undefined}
      />

      {isOrganizer && event.status !== 'cancelled' ? (
        <>
          <Button
            variant="secondary"
            disabled={busy}
            onPress={() => run(() => addEventTable(event.id))}
            accessibilityLabel="Add a table"
          >
            Add a table
          </Button>

          <Link
            href={`/clubs/${clubId}/events/${eventId}/edit`}
            style={styles.linkRow}
          >
            <Text style={styles.link}>Edit this game</Text>
          </Link>
        </>
      ) : null}

      {/*
        Deliberately NOT nested inside the block above, even though every
        current `canReset` case also satisfies `isOrganizer && event.status
        !== 'cancelled'`. `canReset` already carries its own status and
        isOrganizer checks (see its definition above) -- nesting it under an
        outer block gated on the same condition would make that condition
        untestable in isolation: removing it from `canReset` would have no
        observable effect, since the surrounding block hides the whole
        section anyway. Keeping this independent means each condition inside
        `canReset` is the one thing standing between a customised occurrence
        and the button rendering.
      */}
      {canReset ? (
        <Button
          variant="secondary"
          disabled={busy}
          onPress={() => run(() => resetEventToSeries(event.id))}
          accessibilityLabel="Reset to the series"
        >
          Reset to the series
        </Button>
      ) : null}

      {isOrganizer && event.status !== 'cancelled' ? (
        <Button
          variant="ghost"
          disabled={busy}
          onPress={() => run(() => cancelEvent(event.id))}
          accessibilityLabel="Cancel this game"
        >
          Cancel this game
        </Button>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
  },
  when: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  where: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[2],
  },
  notes: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    lineHeight: 26,
  },
  sectionTitle: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
    marginTop: space[4],
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[2],
    marginTop: space[3],
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  linkRow: { marginTop: space[4] },
  link: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.accentColor,
  },
});
