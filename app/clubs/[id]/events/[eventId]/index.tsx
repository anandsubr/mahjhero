import { Link, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../../components/Button';
import Card from '../../../../../components/Card';
import ErrorBanner from '../../../../../components/ErrorBanner';
import Screen from '../../../../../components/Screen';
import Tag from '../../../../../components/Tag';
import TableCard from '../../../../../components/TableCard';
import WaitlistPanel from '../../../../../components/WaitlistPanel';
import { ChevronLeftIcon } from '../../../../../components/icons';
import { canInvite, fetchClub, fetchRoster } from '../../../../../lib/clubs';
import type { Club } from '../../../../../lib/clubs';
import {
  acceptPromotionOffer,
  cancelBooking,
  commitBooking,
  declinePromotionOffer,
  fetchEventSeating,
  needsAFourth,
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
  type SkillTier,
} from '../../../../../lib/events';
import { useSession } from '../../../../../lib/session';
import { colors, space, type } from '../../../../../lib/theme';

const TIERS: { value: SkillTier; label: string }[] = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

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
 * functions below enforce) additionally get table management (rendered
 * into `TableCard`'s `children` slot), an edit link (Task 15), a cancel
 * action, and — only on a series occurrence they have personally
 * customised — a "Reset to the series" control.
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

  // A promotion offer currently held open for this member's group. Nothing
  // in lib/bookings.ts exposes a way to *read* `promotion_offers` yet
  // (Task 8 shipped only the accept/decline writes), so this stays null
  // until a later plan adds that fetch — the state and the panel wiring
  // exist now so that plan only has to set it, not build the rendering.
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

  const me = session?.user.id ?? '';

  async function load() {
    const [loadedClub, loadedEvent, loadedTables, roster, seatingRows] =
      await Promise.all([
        fetchClub(clubId),
        fetchEvent(eventId),
        fetchEventTables(eventId),
        fetchRoster(clubId),
        fetchEventSeating(eventId),
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

    // A roster fetch failure fails closed to "not an organizer" rather than
    // blanking the screen — the member-facing content above is unaffected,
    // and the worst case is a host who temporarily loses their controls
    // rather than a page that cannot render at all.
    const myRole = (roster ?? []).find(
      (m) => m.profile_id === session?.user.id,
    );
    setIsOrganizer(myRole ? canInvite(myRole.role) : false);
    setMySkillLevel(myRole?.skill_level ?? null);

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

  const myHoldsSeat = seating.some(
    (o) => o.profile_id === me && (o.status === 'confirmed' || o.status === 'waitlisted'),
  );

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

  function takeSeat(table: EventTable) {
    const warning = tierWarning(table.skill_tier, mySkillLevel, table.label);
    // The soft warning, and the entire enforcement of skill tiers in this
    // product. The database does not check; the host can move people.
    if (warning) {
      setPendingTier({ tableId: table.id, message: warning });
      return;
    }
    void bookSeat(table.id);
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
          const confirmedHere = tableOccupants.filter(
            (o) => o.status === 'confirmed',
          ).length;
          return (
            <TableCard
              key={table.id}
              table={table}
              occupants={tableOccupants}
              youId={me}
              // Omitted entirely — not a disabled control — for a cancelled
              // or already-started game. See `canBook`'s own comment.
              onTakeSeat={canBook ? () => takeSeat(table) : undefined}
              busy={busy}
              needsFourth={needsAFourth(
                table.capacity,
                confirmedHere,
                new Date(event.starts_at),
                now,
              )}
            >
              {isOrganizer ? (
                <>
                  <View style={styles.chips}>
                    {TIERS.map((tier) => (
                      <Button
                        key={tier.value}
                        variant={
                          table.skill_tier === tier.value ? 'primary' : 'secondary'
                        }
                        big={false}
                        disabled={busy}
                        onPress={() =>
                          run(() => updateEventTable(table.id, { tier: tier.value }))
                        }
                        accessibilityLabel={`${table.label}: ${tier.label}`}
                        accessibilityState={{
                          selected: table.skill_tier === tier.value,
                        }}
                      >
                        {tier.label}
                      </Button>
                    ))}
                  </View>

                  {tables.length > 1 ? (
                    <Button
                      variant="ghost"
                      big={false}
                      disabled={busy}
                      onPress={() => run(() => removeEventTable(table.id))}
                      accessibilityLabel={`Remove ${table.label}`}
                    >
                      Remove
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
                void bookSeat(tableId);
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

      <WaitlistPanel
        unseated={seating.filter(
          (o) => o.status === 'confirmed' && o.event_table_id === null,
        )}
        waiting={seating.filter((o) => o.status === 'waitlisted')}
        youId={me}
        offer={offer}
        now={now}
        busy={busy}
        onAcceptOffer={acceptOffer}
        onDeclineOffer={declineOffer}
        onLeaveWaitlist={leaveWaitlist}
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
