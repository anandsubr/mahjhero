import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import DateField from '../../../../../components/DateField';
import ErrorBanner from '../../../../../components/ErrorBanner';
import {
  ActionBar,
  ConfirmSheet,
  FormCard,
  FormHeader,
  FormSection,
  FormTitle,
  GhostLink,
  MoneyCards,
  Segmented,
  StartTimeRow,
  TablesCard,
  TextRow,
  ToggleRow,
  formStyles,
  type TableDraft,
} from '../../../../../components/GameForm';
import { ClipboardCheckIcon, LockIcon } from '../../../../../components/icons';
import Screen from '../../../../../components/Screen';
import TabBar from '../../../../../components/TabBar';
import TimeField from '../../../../../components/TimeField';
import VenuePicker from '../../../../../components/VenuePicker';
import type { SkillTier } from '../../../../../lib/bookings';
import { fetchClub, type Club, type GameMode } from '../../../../../lib/clubs';
import {
  addEventTable,
  cancelEvent,
  endEventSeries,
  eventDateInZone,
  eventStartTimeInZone,
  fetchEvent,
  fetchEventTables,
  fetchFutureOccurrenceCount,
  fetchOverriddenOccurrences,
  fetchSeries,
  formatEventWhen,
  frequencyLabel,
  parseDollarsToCents,
  removeEventTable,
  updateEvent,
  updateEventSeries,
  updateEventTable,
  type ClubEvent,
  type EventSeries,
  type EventTable,
  type SeatingMode,
} from '../../../../../lib/events';
import { useSession } from '../../../../../lib/session';
import { dateToDateString } from '../../../../../lib/time';
import { colors, space, type } from '../../../../../lib/theme';

type Scope = 'event' | 'series';

/** The inverse of lib/events.ts's parseDollarsToCents, for seeding a text
 *  field from a stored cents value. `0` renders as `"0"`, not `""` — an
 *  explicit zero the host can see and overwrite, not a blank field that
 *  looks unset. */
function centsToDollarsText(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * The optional capacity field's parse boundary -- mirrors this file's own
 * `centsToDollarsText`-adjacent sibling in app/clubs/[id]/events/new.tsx.
 * Blank text means "no limit" (`null`). Not shared across the two files for
 * the same reason `Chip`/`ScopeChip` are not -- see this file's and
 * new.tsx's own docstrings on that convention.
 *
 * Finding #5 of the final review: this used to map ANY non-numeric text to
 * `null` too, the same as blank -- degrading `NaN` rather than sending it to
 * the RPC was the right instinct, but conflating "unparseable" (a typo, `6o`
 * for `60`) with "deliberately left blank" was not. Combined with the
 * touched flag below, an organizer with a real 60-person cap who fat-
 * fingered `6o` had it silently removed on save, with no error and no
 * confirmation. This now returns a third state for that case, and `onSave`
 * below refuses to save rather than guessing.
 */
type CapacityParse = { valid: true; value: number | null } | { valid: false };

function parseCapacity(text: string): CapacityParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { valid: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { valid: false };
  return { valid: true, value: Math.trunc(n) };
}

const INVALID_CAPACITY_MESSAGE =
  'Enter a whole number of players, or leave it blank for no limit.';

/** The single occurrence's own values, snapshotted once on load, so the
 * "This game" save path can tell what actually changed and send only that —
 * see the file-level comment above `onSave` for why that matters here in a
 * way it does not for the series path. */
type OriginalOccurrence = {
  title: string;
  venueId: string;
  notes: string;
  date: string;
  startTime: string;
  checkInRequired: boolean;
  gameMode: GameMode;
  feeCents: number;
  minSpendCents: number;
  seatingMode: SeatingMode;
};

/**
 * Edits a game, or the series behind it.
 *
 * The scope choice ("This game" / "The whole series") only appears when
 * there is a series to choose between — a one-off event has none, and the
 * form below edits it directly with no mention of scope at all.
 *
 * Two save paths behave differently on purpose:
 *
 *   - "The whole series" always sends every field to `updateEventSeries`.
 *     That is safe ONLY because the series-scope fields below are seeded
 *     from the SERIES row (`series.title` / `series.venue_id` / etc — see
 *     the load effect below), never from the occurrence being viewed. An
 *     untouched field then round-trips as the series' own current value,
 *     which the RPC's gate — comparing the incoming value against `se`, the
 *     row it just read `for update` (supabase/migrations/20260823040000) —
 *     correctly treats as a no-op.
 *
 *     Fix pass 1 on this task's review found this screen seeding those same
 *     fields from the OCCURRENCE instead, on the mistaken belief that the
 *     RPC's gate made the source irrelevant. It does not: an overridden
 *     occurrence's values differ from the series precisely BECAUSE they are
 *     overridden, so every gate fired and choosing "The whole series" and
 *     changing nothing silently rewrote every live future week to that one
 *     week's customisation (see .superpowers/sdd/task-15-report.md). Do not
 *     reintroduce that by sharing form state across scopes again — this is
 *     exactly why event- and series-scope fields are separate state below,
 *     not one shared set re-labelled by heading.
 *   - "This game" only sends the fields that changed from what this
 *     occurrence already had. `updateEvent` does NOT re-derive "did this
 *     change" the same way: any non-null date/time/duration argument pushes
 *     it into a full recompute of the instant from
 *     `(date + time) at time zone club_tz`, even when the value supplied is
 *     the same one already stored — which is only the identity operation
 *     outside a DST fall-back's repeated local hour. Inside it, sending the
 *     same wall-clock time back round-trips to a DIFFERENT instant and
 *     records a false `starts_at` override for an edit that named no real
 *     change. So this screen only ever sends `startTime` (or title/venue/
 *     notes) when the host actually touched it.
 */

/** A table as the form holds it until Save: `id` null for one added here. */
type StagedTable = TableDraft & { id: string | null };

function stageTables(tables: EventTable[]): StagedTable[] {
  return [...tables]
    .sort((a, b) => a.position - b.position)
    .map((t) => ({ key: t.id, id: t.id, label: t.label, tier: t.skill_tier }));
}

export default function EditEventScreen() {
  const { id: clubId, eventId } = useLocalSearchParams<{
    id: string;
    eventId: string;
  }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [event, setEvent] = useState<ClubEvent | null>(null);
  const [series, setSeries] = useState<EventSeries | null>(null);
  // Distinct from `series === null`, which also means "this event has no
  // series" -- true only when the event DOES have a series_id and the fetch
  // for it came back empty. Conflating the two would silently misrepresent a
  // failed load as "this is a one-off event", the same false-statement shape
  // Task 14's brief hit with a failed tables fetch reading as zero tables.
  const [seriesFailed, setSeriesFailed] = useState(false);
  const [customised, setCustomised] = useState<ClubEvent[]>([]);
  const [overriddenFailed, setOverriddenFailed] = useState(false);
  // null after `ready` means the count could not be loaded, not "zero" --
  // the same reasoning as seriesFailed above.
  const [futureCount, setFutureCount] = useState<number | null>(null);
  // This game's tables, editable below regardless of `scope` -- tables are
  // per-occurrence, not part of either the "This game" or "The whole
  // series" field sets tracked elsewhere on this screen. `tablesFailed`
  // follows the same "distinct from empty" reasoning as `seriesFailed`
  // above: a failed fetch must not read as "this game has no tables".
  const [tables, setTables] = useState<EventTable[]>([]);
  const [tablesFailed, setTablesFailed] = useState(false);
  // The Tables card's working copy, applied only on Save (see
  // `applyTableChanges`) -- the stepper and level taps are part of the form,
  // so Cancel discards them like every other field.
  const [tableDraft, setTableDraft] = useState<StagedTable[]>([]);
  const [ready, setReady] = useState(false);

  const [scope, setScope] = useState<Scope>('event');
  // Two independent snapshots, not one shared set of fields re-labelled by
  // heading -- see the file-level comment above for why the series-scope
  // save path depends on its fields never having come from the occurrence.
  // "This game" edits eventTitle/eventVenueId/etc, diffed against `original`
  // below; "The whole series" edits seriesTitle/seriesVenueId/etc, sent
  // unconditionally and relying on the RPC's own gate.
  const [eventTitle, setEventTitle] = useState('');
  const [eventVenueId, setEventVenueId] = useState<string | null>(null);
  const [eventVenueName, setEventVenueName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventStartTime, setEventStartTime] = useState('19:00');
  const [eventNotes, setEventNotes] = useState('');
  const [eventCheckInRequired, setEventCheckInRequired] = useState(false);
  const [eventGameMode, setEventGameMode] = useState<GameMode>('open_play');
  const [eventFeeText, setEventFeeText] = useState('');
  const [eventMinSpendText, setEventMinSpendText] = useState('');
  // Seeded from `event.seating_mode` below, so this diffs against `original`
  // exactly like every other "This game" field above.
  const [eventSeatingMode, setEventSeatingMode] = useState<SeatingMode>(
    'assigned_tables',
  );
  // Pre-filled from `event.capacity` below (EVENT_COLUMNS now selects it —
  // see this file's own bug report on this fix) so an organizer opening an
  // already-capped game sees the real cap instead of a blank field that
  // reads as uncapped. NOT diffed against a fetched original the way
  // `eventSeatingMode` is, on purpose: `eventCapacityTouched` below is the
  // sole signal onSave uses, and pre-filling this text state must never by
  // itself flip that flag — see its own doc for why that distinction has to
  // hold exactly, even now that a real fetched value exists to seed from.
  const [eventCapacityText, setEventCapacityText] = useState('');
  // True once the host has typed anything into the capacity field this
  // mount, including clearing it back out -- NOT set by the load effect's
  // pre-fill of `eventCapacityText` above, which uses the raw setter rather
  // than this state's own touch-tracking setter (see `setCapacityText`
  // below). Without this flag, a field pre-filled with the stored capacity
  // (or left blank when genuinely uncapped) would be indistinguishable from
  // a host who opened the form and did nothing, and `onSave` below needs to
  // tell those apart: the former must leave the stored capacity alone, the
  // latter must send `clearCapacity: true`.
  const [eventCapacityTouched, setEventCapacityTouched] = useState(false);
  const [original, setOriginal] = useState<OriginalOccurrence | null>(null);

  const [seriesTitle, setSeriesTitle] = useState('');
  const [seriesVenueId, setSeriesVenueId] = useState<string | null>(null);
  const [seriesVenueName, setSeriesVenueName] = useState('');
  const [seriesStartTime, setSeriesStartTime] = useState('19:00');
  const [seriesNotes, setSeriesNotes] = useState('');
  const [seriesCheckInRequired, setSeriesCheckInRequired] = useState(false);
  const [seriesGameMode, setSeriesGameMode] = useState<GameMode>('open_play');
  const [seriesFeeText, setSeriesFeeText] = useState('');
  const [seriesMinSpendText, setSeriesMinSpendText] = useState('');
  // Unlike every other series-scope field above, these two are still NOT
  // sent unconditionally even though SERIES_COLUMNS now selects both
  // `seating_mode` and `capacity` (this fix) and the load effect below does
  // pre-fill them for display. Sending them unconditionally the way
  // title/venue/notes/checkInRequired do would risk silently overwriting a
  // series' real mode with whatever this state happens to hold the moment
  // the host saved "The whole series" without touching either control --
  // exactly the class of bug this file's own docstring recounts for Fix
  // pass 1, and pre-filling from a real fetched value does not remove that
  // risk, since a stale or slow-to-load fetch could still leave the wrong
  // value sitting here at save time. So these follow `eventCapacityText`'s
  // touched-flag pattern instead of the rest of the series-scope fields'
  // "always seeded, always sent" one: untouched means "leave alone" for
  // both, matching `updateEventSeries`'s own null/omitted semantics. The
  // load effect's pre-fill below uses the raw setters, never the
  // touch-tracking wrappers (`setSeatingMode`/`setCapacityText` further
  // down), so hydrating the display can never itself mark either touched.
  const [seriesSeatingMode, setSeriesSeatingMode] = useState<SeatingMode>(
    'assigned_tables',
  );
  const [seriesSeatingModeTouched, setSeriesSeatingModeTouched] = useState(false);
  const [seriesCapacityText, setSeriesCapacityText] = useState('');
  const [seriesCapacityTouched, setSeriesCapacityTouched] = useState(false);
  // The series' own "stop repeating on". Kept apart from `runsIndefinitely`
  // (see that state's own note) rather than folded into a single nullable
  // string, because DateField has no way to produce an empty string through
  // its own UI -- there has to be a second, independent control for "clear
  // it", and that control needs its own boolean to drive.
  const [endsOn, setEndsOn] = useState('');
  // True when the series has no end date, OR when the host has just turned
  // this on to clear one. This is the "Runs indefinitely" control the create
  // screen's DateField cannot offer on its own: DateField ignores an empty
  // change by design (see its own doc comment), and `new_ends_on` on
  // `update_event_series` already means "leave alone" at null -- there was no
  // way to ask it to CLEAR an end date until
  // supabase/migrations/20260823080000 added `clear_ends_on` as a second,
  // unambiguous signal. This toggle is what drives that argument.
  const [runsIndefinitely, setRunsIndefinitely] = useState(false);
  // Snapshotted once per mount, not recomputed per render -- a floor, not a
  // clock. Device-local, which is close enough for a picker; see
  // components/DateField.tsx.
  const [today] = useState(() => dateToDateString(new Date()));
  const [includeOverridden, setIncludeOverridden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which bottom-sheet confirmation is up, if any.
  const [confirming, setConfirming] = useState<'discard' | 'unseat' | 'cancelGame' | null>(null);

  // Everything the host can change, for "has anything been changed?" --
  // baselined once the load effect has seeded it all.
  const formSnapshot = JSON.stringify([
    scope, eventTitle, eventVenueId, eventDate, eventStartTime, eventNotes,
    eventCheckInRequired, eventGameMode, eventFeeText, eventMinSpendText,
    eventSeatingMode, eventCapacityText, seriesTitle, seriesVenueId, seriesStartTime,
    seriesNotes, seriesCheckInRequired, seriesGameMode, seriesFeeText, seriesMinSpendText,
    seriesSeatingMode, seriesCapacityText, endsOn, runsIndefinitely, includeOverridden,
    tableDraft.map((t) => [t.id, t.tier]),
  ]);
  const baselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (ready && baselineRef.current === null) baselineRef.current = formSnapshot;
  }, [ready, formSnapshot]);
  const dirty = baselineRef.current !== null && baselineRef.current !== formSnapshot;

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    (async () => {
      const [loadedClub, loadedEvent, loadedTables] = await Promise.all([
        fetchClub(clubId),
        fetchEvent(eventId),
        fetchEventTables(eventId),
      ]);
      if (cancelled) return;

      setClub(loadedClub);
      setEvent(loadedEvent);
      setTablesFailed(loadedTables === null);
      setTables(loadedTables ?? []);
      setTableDraft(stageTables(loadedTables ?? []));

      if (loadedEvent && loadedClub) {
        const initialStartTime = eventStartTimeInZone(
          loadedEvent.starts_at,
          loadedClub.timezone,
        );
        setEventTitle(loadedEvent.title);
        setEventVenueId(loadedEvent.venue_id);
        setEventVenueName(loadedEvent.venue_name);
        setEventNotes(loadedEvent.notes);
        setEventDate(eventDateInZone(loadedEvent.starts_at, loadedClub.timezone));
        setEventStartTime(initialStartTime);
        setEventCheckInRequired(loadedEvent.check_in_required);
        setEventGameMode(loadedEvent.game_mode);
        setEventFeeText(centsToDollarsText(loadedEvent.fee_cents));
        setEventMinSpendText(centsToDollarsText(loadedEvent.min_spend_cents));
        setEventSeatingMode(loadedEvent.seating_mode);
        // Raw setter, not `setCapacityText` (the touch-tracking wrapper the
        // TextField's own onChangeText below uses) -- this is a hydration of
        // what's already stored, not the host touching the field. `null`
        // (uncapped) renders as an empty string, matching the placeholder's
        // own "no limit" meaning; a real cap renders as its plain digits, so
        // an organizer opening a game already capped at 60 sees "60", not a
        // blank field that reads as uncapped.
        setEventCapacityText(
          loadedEvent.capacity === null ? '' : String(loadedEvent.capacity),
        );
        setOriginal({
          title: loadedEvent.title,
          venueId: loadedEvent.venue_id,
          notes: loadedEvent.notes,
          date: eventDateInZone(loadedEvent.starts_at, loadedClub.timezone),
          startTime: initialStartTime,
          checkInRequired: loadedEvent.check_in_required,
          gameMode: loadedEvent.game_mode,
          feeCents: loadedEvent.fee_cents,
          minSpendCents: loadedEvent.min_spend_cents,
          seatingMode: loadedEvent.seating_mode,
        });
      }

      if (loadedEvent?.series_id) {
        const [loadedSeries, loadedCustomised, loadedFutureCount] = await Promise.all([
          fetchSeries(loadedEvent.series_id),
          fetchOverriddenOccurrences(loadedEvent.series_id),
          fetchFutureOccurrenceCount(loadedEvent.series_id),
        ]);
        if (cancelled) return;

        setSeries(loadedSeries);
        setSeriesFailed(loadedSeries === null);
        setOverriddenFailed(loadedCustomised === null);
        setCustomised(loadedCustomised ?? []);
        setFutureCount(loadedFutureCount);

        if (loadedSeries) {
          setSeriesTitle(loadedSeries.title);
          setSeriesVenueId(loadedSeries.venue_id);
          setSeriesVenueName(loadedSeries.venue_name);
          setSeriesNotes(loadedSeries.notes);
          // Postgres `time` arrives as "HH:MM:SS"; the form's whole surface
          // is HH:MM (TimeField, TIME_PATTERN-shaped inputs elsewhere in the
          // app) -- mirrors lib/profile.ts's normalizeTime for the same
          // quiet_hours_start/end shape, kept local here since this is the
          // only place in lib/events.ts's domain that reads a `time` column
          // back into a form field.
          setSeriesStartTime(loadedSeries.start_time.slice(0, 5));
          setSeriesCheckInRequired(loadedSeries.check_in_required);
          setSeriesGameMode(loadedSeries.game_mode);
          setSeriesFeeText(centsToDollarsText(loadedSeries.fee_cents));
          setSeriesMinSpendText(centsToDollarsText(loadedSeries.min_spend_cents));
          // Raw setters, exactly like the event-scope pre-fill above and for
          // the same reason: this hydrates the series scope's seating-mode
          // chip and capacity field from what the series actually has,
          // without marking either `seriesSeatingModeTouched` or
          // `seriesCapacityTouched` -- those flags are `setSeatingMode`'s and
          // `setCapacityText`'s job (see their definitions below), fired only
          // when the host actually interacts with the control, never by this
          // load effect.
          setSeriesSeatingMode(loadedSeries.seating_mode);
          setSeriesCapacityText(
            loadedSeries.capacity === null ? '' : String(loadedSeries.capacity),
          );
          setEndsOn(loadedSeries.ends_on ?? '');
          setRunsIndefinitely(loadedSeries.ends_on === null);
        }
      }

      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [clubId, eventId, session]);

  // Every state below carries the tab bar, the same rule
  // app/clubs/[id]/index.tsx and app/clubs/[id]/venues.tsx already follow:
  // TabBar navigates with router.replace off an entry route that is itself
  // a <Redirect>, so the history stack is typically one deep, and a state
  // with no bar strands a host with no way out but relaunching the app. The
  // <Redirect> branch below is the deliberate exception -- it renders
  // nothing, and a signed-out visitor belongs at sign-in, not in a tab bar.
  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  // Checked before the `!ready` guard below, deliberately: `ready` is only
  // ever set inside the effect above, which returns immediately when there
  // is no session. A signed-out visitor can never make `ready` true, so
  // checking `!ready` first would strand them on a spinner instead of
  // sending them to sign in -- this exact ordering bug has now appeared in
  // three separate briefs for this branch, this task's own included (its
  // Step 1 sample put the checks in the wrong order).
  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!club || !event) {
    return (
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <ErrorBanner message="That game could not be loaded." />
      </Screen>
    );
  }

  // A game whose stored start time cannot be parsed cannot be edited: the
  // form's TimeField has no honest way to show an unknown time. On web it
  // would render empty, but the native picker has no empty state — it falls
  // back to midnight (lib/time.ts's timeStringToDate), shows a plausible
  // "12:00 AM", and a host who merely confirms the dialog saves a midnight
  // nobody chose over the real value. Refusing the whole form is the only
  // answer that cannot lose the stored time.
  if (Number.isNaN(new Date(event.starts_at).getTime())) {
    return (
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <ErrorBanner message="This game's start time could not be read, so it cannot be edited." />
      </Screen>
    );
  }

  // Which snapshot the visible form fields (and onSave below) read from.
  // `series` must also be non-null, matching onSave's own condition. On
  // this screen the guard is currently unreachable: the scope buttons that
  // set `scope` to 'series' only render when `series` is already truthy
  // (see the `{series ? ... }` block below), and the single load effect
  // never resets `series` back to null once set, so there is no render
  // where `scope === 'series'` and `series === null` both hold. Kept
  // anyway as a defensive pairing with onSave's identical condition --
  // cheap insurance against a future change to either the load effect or
  // the scope buttons' render guard reintroducing that combination.
  const isSeriesScope = scope === 'series' && series !== null;
  const title = isSeriesScope ? seriesTitle : eventTitle;
  const setTitle = isSeriesScope ? setSeriesTitle : setEventTitle;
  const venueId = isSeriesScope ? seriesVenueId : eventVenueId;
  const venueName = isSeriesScope ? seriesVenueName : eventVenueName;
  const setVenue = isSeriesScope
    ? (id: string, name: string) => {
        setSeriesVenueId(id);
        setSeriesVenueName(name);
      }
    : (id: string, name: string) => {
        setEventVenueId(id);
        setEventVenueName(name);
      };
  const startTime = isSeriesScope ? seriesStartTime : eventStartTime;
  const setStartTime = isSeriesScope ? setSeriesStartTime : setEventStartTime;
  const notes = isSeriesScope ? seriesNotes : eventNotes;
  const setNotes = isSeriesScope ? setSeriesNotes : setEventNotes;
  const checkInRequired = isSeriesScope ? seriesCheckInRequired : eventCheckInRequired;
  const setCheckInRequired = isSeriesScope
    ? setSeriesCheckInRequired
    : setEventCheckInRequired;
  const gameMode = isSeriesScope ? seriesGameMode : eventGameMode;
  const setGameMode = isSeriesScope ? setSeriesGameMode : setEventGameMode;
  const feeText = isSeriesScope ? seriesFeeText : eventFeeText;
  const setFeeText = isSeriesScope ? setSeriesFeeText : setEventFeeText;
  const minSpendText = isSeriesScope ? seriesMinSpendText : eventMinSpendText;
  const setMinSpendText = isSeriesScope ? setSeriesMinSpendText : setEventMinSpendText;
  const seatingMode = isSeriesScope ? seriesSeatingMode : eventSeatingMode;
  // The series-scope setter also flips its own touched flag -- see
  // `seriesSeatingModeTouched`'s doc above for why this scope cannot simply
  // diff against a fetched original the way the event scope's plain
  // `setEventSeatingMode` gets to.
  const setSeatingMode = isSeriesScope
    ? (next: SeatingMode) => {
        setSeriesSeatingMode(next);
        setSeriesSeatingModeTouched(true);
      }
    : setEventSeatingMode;
  const capacityText = isSeriesScope ? seriesCapacityText : eventCapacityText;
  const setCapacityText = isSeriesScope
    ? (next: string) => {
        setSeriesCapacityText(next);
        setSeriesCapacityTouched(true);
      }
    : (next: string) => {
        setEventCapacityText(next);
        setEventCapacityTouched(true);
      };

  // Arrow functions assigned to `const`, not `function` declarations --
  // TypeScript only carries the `!club || !event` narrowing above into a
  // nested closure when it can prove the captured binding is never
  // reassigned, and a hoisted function declaration doesn't give it that
  // guarantee the way a const-bound closure defined after the guard does.
  // Tables the draft no longer has, and who is seated at them -- removing a
  // table unseats its players and notifies each of them
  // (remove_event_table), so Save asks first.
  const removedTables = tables.filter((t) => !tableDraft.some((d) => d.id === t.id));
  const unseatCount = (event.bookings ?? []).filter(
    (b) => b.status === 'confirmed' && removedTables.some((t) => t.id === b.event_table_id),
  ).length;

  /**
   * Applies the Tables card's staged changes, after the game's own update
   * has succeeded: removals (last first), additions, then level changes --
   * for added tables, once their ids exist. Stops at the first refusal and
   * returns it; the caller then reloads the real tables into the draft.
   * Open seating has no tables to change, so nothing is sent for it.
   */
  const applyTableChanges = async (): Promise<string | null> => {
    if (seatingMode !== 'assigned_tables') return null;
    for (const table of [...removedTables].reverse()) {
      const { error: removeError } = await removeEventTable(table.id);
      if (removeError) return removeError;
    }
    const added = tableDraft.filter((d) => d.id === null);
    for (let i = 0; i < added.length; i += 1) {
      const { error: addError } = await addEventTable(event.id);
      if (addError) return addError;
    }
    for (const draft of tableDraft) {
      const before = tables.find((t) => t.id === draft.id);
      if (before && before.skill_tier !== draft.tier) {
        const { error: tierError } = await updateEventTable(before.id, { tier: draft.tier });
        if (tierError) return tierError;
      }
    }
    if (added.some((d) => d.tier !== 'mixed')) {
      const fresh = await fetchEventTables(event.id);
      if (fresh === null) return "The tables were added, but their levels couldn't be set.";
      const kept = new Set(tableDraft.filter((d) => d.id !== null).map((d) => d.id));
      const newOnes = [...fresh]
        .filter((t) => !kept.has(t.id))
        .sort((a, b) => a.position - b.position);
      for (let i = 0; i < added.length && i < newOnes.length; i += 1) {
        if (added[i].tier === 'mixed') continue;
        const { error: tierError } = await updateEventTable(newOnes[i].id, { tier: added[i].tier });
        if (tierError) return tierError;
      }
    }
    return null;
  };

  const reloadTables = async () => {
    const fresh = await fetchEventTables(event.id);
    if (fresh !== null) {
      setTables(fresh);
      setTableDraft(stageTables(fresh));
    }
  };

  const onSave = async (unseatConfirmed = false) => {
    // Refuse an unparseable capacity outright, before touching the network
    // -- see parseCapacity's own doc for the typo (`6o` for `60`) this
    // guards against. `capacityText`/`isSeriesScope` above already resolve
    // to whichever scope's own field this save is about, so one parse here
    // covers both the series and single-event branches below -- checked
    // ahead of `setSaving(true)` so a refusal never shows a spinner, and
    // skipped entirely when the field was never touched (an untouched
    // field's stored value, or its own genuinely-blank pre-fill, was never
    // typed by this host and cannot be a typo).
    const capacityTouched = isSeriesScope
      ? seriesCapacityTouched
      : eventCapacityTouched;
    const capacityParsed = parseCapacity(capacityText);
    if (capacityTouched && !capacityParsed.valid) {
      setError(INVALID_CAPACITY_MESSAGE);
      return;
    }

    if (unseatCount > 0 && !unseatConfirmed) {
      setConfirming('unseat');
      return;
    }

    setSaving(true);
    setError(null);

    if (scope === 'series' && series) {
      // "Leave alone" (undefined -> null) unless the host actually named a
      // new date, or turned "Runs indefinitely" on for a series that had a
      // real end date to clear. See `clearEndsOn`'s own doc for why these
      // are two separate signals rather than one.
      let endsOnInput: string | undefined;
      let clearEndsOn = false;
      if (runsIndefinitely) {
        if (series.ends_on !== null) clearEndsOn = true;
      } else if (endsOn.length > 0 && endsOn !== series.ends_on) {
        endsOnInput = endsOn;
      }

      // Unlike every field above, these two are "leave alone unless
      // touched" even though the series row now seeds their DISPLAY (see
      // `seriesSeatingMode`'s own doc for why the send path still ignores
      // that fetched value) -- an untouched control here must send nothing
      // rather than whatever this state currently holds. `capacityParsed`
      // (computed once above, and already guaranteed `valid` by the guard
      // above whenever `seriesCapacityTouched`) `.value === null` covers
      // both "never touched" and "touched, then emptied again" --
      // `seriesCapacityTouched` is what tells those two apart.
      const result = await updateEventSeries(series.id, {
        title,
        venueId,
        notes,
        startTime,
        checkInRequired,
        gameMode,
        feeCents: parseDollarsToCents(feeText),
        minSpendCents: parseDollarsToCents(minSpendText),
        endsOn: endsOnInput,
        clearEndsOn,
        includeOverridden,
        seatingMode: seriesSeatingModeTouched ? seriesSeatingMode : null,
        capacity:
          seriesCapacityTouched &&
          capacityParsed.valid &&
          capacityParsed.value !== null
            ? capacityParsed.value
            : null,
        clearCapacity:
          seriesCapacityTouched &&
          capacityParsed.valid &&
          capacityParsed.value === null,
      });
      if (result.error) {
        setSaving(false);
        setError(result.error);
        return;
      }
    } else {
      // Only what actually changed -- see the file-level comment above this
      // component for why `updateEvent` needs that discipline and
      // `updateEventSeries` does not.
      const titleChanged = original ? title.trim() !== original.title : false;
      const venueChanged = original ? venueId !== original.venueId : false;
      const notesChanged = original ? notes !== original.notes : false;
      const startTimeChanged = original ? startTime !== original.startTime : false;
      const dateChanged = original ? eventDate !== original.date : false;
      const checkInChanged = original
        ? checkInRequired !== original.checkInRequired
        : false;
      const gameModeChanged = original ? gameMode !== original.gameMode : false;
      const feeCentsValue = parseDollarsToCents(feeText);
      const minSpendCentsValue = parseDollarsToCents(minSpendText);
      const feeChanged = original ? feeCentsValue !== original.feeCents : false;
      const minSpendChanged = original
        ? minSpendCentsValue !== original.minSpendCents
        : false;
      const seatingModeChanged = original
        ? eventSeatingMode !== original.seatingMode
        : false;
      // `capacity` is deliberately NOT diffed against `original` the way
      // title/venue/notes/etc above are, even though a real fetched value
      // now exists to diff against (see `eventCapacityText`'s own doc for
      // why) -- `eventCapacityTouched` is what stands in for "changed" here.
      // `capacityParsed.value === null` covers both "never touched" and
      // "touched, then emptied again"; the touched flag is what tells those
      // two apart, exactly as it does for the series-scope save above.
      const result = await updateEvent(event.id, {
        title: titleChanged ? title.trim() : null,
        venueId: venueChanged ? venueId : null,
        notes: notesChanged ? notes : null,
        date: dateChanged ? eventDate : null,
        startTime: startTimeChanged ? startTime : null,
        checkInRequired: checkInChanged ? checkInRequired : null,
        gameMode: gameModeChanged ? gameMode : null,
        feeCents: feeChanged ? feeCentsValue : null,
        minSpendCents: minSpendChanged ? minSpendCentsValue : null,
        seatingMode: seatingModeChanged ? eventSeatingMode : null,
        capacity:
          eventCapacityTouched &&
          capacityParsed.valid &&
          capacityParsed.value !== null
            ? capacityParsed.value
            : null,
        clearCapacity:
          eventCapacityTouched &&
          capacityParsed.valid &&
          capacityParsed.value === null,
      });
      if (result.error) {
        setSaving(false);
        setError(result.error);
        return;
      }
    }

    const tableError = await applyTableChanges();
    setSaving(false);
    if (tableError) {
      setError(tableError);
      void reloadTables();
      return;
    }

    router.replace(`/clubs/${clubId}/events/${eventId}`);
  };

  const onCancelGame = async () => {
    setConfirming(null);
    setSaving(true);
    setError(null);
    const result = await cancelEvent(event.id);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.replace(`/clubs/${clubId}/events/${eventId}`);
  };

  const leave = () => {
    // A direct URL, a page reload on web, a deep link, or a cold launch
    // straight into this route leaves nothing to pop -- only `back()` when
    // there is history to unwind. The fallback replaces rather than pushes:
    // a pushed event screen would leave this cancelled form one browser-back
    // away, a stale entry the member could stumble straight back into.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/clubs/${clubId}/events/${eventId}`);
    }
  };

  const requestLeave = () => {
    if (dirty) setConfirming('discard');
    else leave();
  };

  const onEndSeries = async () => {
    if (!series) return;
    setSaving(true);
    setError(null);
    const result = await endEventSeries(series.id, true);
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.replace(`/clubs/${clubId}/events/new`);
  };

  const seriesLabel = series
    ? frequencyLabel(series.frequency, series.weekday, series.nth_week)
    : null;

  return (
    <>
      <Screen
        scroll
        contentStyle={formStyles.body}
        tabBar={
          <ActionBar
            onCancel={requestLeave}
            primaryLabel="Save"
            primaryAccessibilityLabel="Save changes"
            onPrimary={() => void onSave()}
            busy={saving}
          />
        }
      >
        <FormHeader clubId={clubId} clubName={club.name} onClose={requestLeave} />
        <FormTitle>Edit</FormTitle>

        {error ? <ErrorBanner message={error} /> : null}

        {event.series_id && seriesFailed ? (
          <ErrorBanner message="Could not load this game's series. You can still edit this game on its own." />
        ) : null}

        {series ? (
          <FormSection label="What are you changing?" helper={seriesLabel}>
            <Segmented
              options={[
                { value: 'event' as const, label: 'This game', accessibilityLabel: 'This game only' },
                { value: 'series' as const, label: 'The whole series' },
              ]}
              value={scope}
              onChange={setScope}
            />
          </FormSection>
        ) : null}

        <FormSection label="Details">
          <FormCard>
            <TextRow
              label="What is it called?"
              value={title}
              onChangeText={setTitle}
              accessibilityLabel="Game name"
            />
            <VenuePicker
              // VenuePicker seeds its own internal search text from
              // `valueName` only on mount -- so switching scope needs a fresh
              // instance to show the newly-active snapshot's venue.
              key={isSeriesScope ? 'series' : 'event'}
              variant="row"
              clubName={club.name}
              clubId={clubId}
              value={venueId}
              valueName={venueName}
              onChange={setVenue}
            />
            <StartTimeRow>
              {/* The date is this game's alone: a series' days are fixed by
                  its rhythm (see "Change the schedule" below). */}
              {isSeriesScope ? null : (
                <DateField value={eventDate} onChange={setEventDate} label="Date" minimum={today} compact />
              )}
              <TimeField value={startTime} onChange={setStartTime} label="Start time" compact />
            </StartTimeRow>
            <TextRow
              label="Anything else? (optional)"
              value={notes}
              onChangeText={setNotes}
              accessibilityLabel="Notes"
              placeholder="Parking, what to bring, house rules…"
              multiline
            />
          </FormCard>
        </FormSection>

        <FormSection
          label="How does this seat people?"
          helper={
            seatingMode === 'assigned_tables'
              ? 'You place players at tables. Set a level for each table.'
              : 'Players take any open seat when they arrive.'
          }
        >
          <Segmented
            options={[
              { value: 'assigned_tables' as const, label: 'Assigned tables' },
              { value: 'open_seating' as const, label: 'Open seating' },
            ]}
            value={seatingMode}
            onChange={setSeatingMode}
          />
        </FormSection>

        {seatingMode === 'open_seating' ? (
          // This cap is independent of table capacity, and entirely optional.
          <FormSection helper="Caps how many players can confirm a spot. Leave blank for no limit.">
            <FormCard>
              <TextRow
                label="Capacity (optional)"
                value={capacityText}
                onChangeText={setCapacityText}
                accessibilityLabel="Capacity (optional)"
                keyboardType="number-pad"
                placeholder="70"
              />
            </FormCard>
          </FormSection>
        ) : tablesFailed ? (
          <Text style={styles.help}>Could not load this game's tables.</Text>
        ) : tableDraft.length > 0 ? (
          // Per-occurrence, whichever scope is chosen: tables belong to this
          // game, never to the series.
          <TablesCard
            tables={tableDraft}
            onAdd={() =>
              setTableDraft((current) => [
                ...current,
                {
                  key: `new-${current.length}-${Date.now()}`,
                  id: null,
                  label: `Table ${current.length + 1}`,
                  tier: 'mixed' as SkillTier,
                },
              ])
            }
            onRemove={() => setTableDraft((current) => current.slice(0, -1))}
            onTierChange={(index, tier) =>
              setTableDraft((current) => current.map((t, i) => (i === index ? { ...t, tier } : t)))
            }
            note={isSeriesScope ? 'Tables are set per game: these apply to this game only.' : null}
          />
        ) : null}

        <FormSection helper="Leave at 0 if it's free.">
          <MoneyCards
            fee={feeText}
            minSpend={minSpendText}
            onFeeChange={setFeeText}
            onMinSpendChange={setMinSpendText}
          />
        </FormSection>

        <FormSection label="Check-in & access">
          <FormCard>
            <ToggleRow
              icon={<ClipboardCheckIcon size={18} color={colors.accent[700]} />}
              title="Require check-in"
              helper="Turn this on and this game gets a door list, so you can check people in as they arrive. Small games usually don't need it."
              value={checkInRequired}
              onValueChange={setCheckInRequired}
            />
            <ToggleRow
              icon={<LockIcon size={18} color={colors.accent[700]} />}
              title="Invite-only"
              helper={
                gameMode === 'invite_only'
                  ? 'Only people you invite can see and join.'
                  : 'Anyone in the club can see and join.'
              }
              value={gameMode === 'invite_only'}
              onValueChange={(next) => setGameMode(next ? 'invite_only' : 'open_play')}
            />
          </FormCard>
        </FormSection>

        {scope === 'series' && series ? (
          <FormSection label="Repeats">
            <FormCard>
              <View style={styles.stopRow}>
                <Text style={styles.stopLabel}>Stop repeating on</Text>
                {runsIndefinitely ? (
                  <Text style={styles.stopValue}>No end date</Text>
                ) : (
                  <DateField
                    value={endsOn}
                    onChange={setEndsOn}
                    label="Stop repeating on"
                    // Today: an end date in the past is not refused by the
                    // database, but it DELETES every future week beyond it
                    // (supabase/migrations/20260824000000), so a mistyped
                    // year here would silently clear the whole run.
                    minimum={today}
                    compact
                  />
                )}
              </View>
              <ToggleRow
                icon={null}
                title="Runs indefinitely"
                helper="No end date. Turn this off to set one."
                accessibilityLabel="Runs indefinitely, with no end date"
                value={runsIndefinitely}
                onValueChange={(next) => {
                  setRunsIndefinitely(next);
                  if (next) {
                    // Clears the picked date along with the toggle -- turning
                    // this back off should not resurrect a date the host just
                    // said they don't want.
                    setEndsOn('');
                  } else {
                    // Restores the series' own end date. Leaving `endsOn` at
                    // '' would show no date while `series.ends_on` is still
                    // set, and the series would silently keep it.
                    setEndsOn(series?.ends_on ?? '');
                  }
                }}
              />
              {/*
                Only rendered when there is something for it to apply to. It
                applies THIS edit to the weeks you've customised, and nothing
                broader: fields this edit did not touch keep their overrides
                either way (supabase/migrations/20260823040000).
              */}
              {!overriddenFailed && customised.length > 0 ? (
                <ToggleRow
                  icon={null}
                  title={`Also apply this edit to the ${customised.length} ${
                    customised.length === 1 ? 'game' : 'games'
                  } you've changed`}
                  helper={`${
                    customised.length <= 3
                      ? `${customised
                          .map((e) => formatEventWhen(e.starts_at, club.timezone))
                          .join(', ')}. `
                      : ''
                  }Cancelled games are never affected.`}
                  accessibilityLabel={`Also apply this edit to the ${customised.length} ${
                    customised.length === 1 ? 'game' : 'games'
                  } you've changed`}
                  value={includeOverridden}
                  onValueChange={setIncludeOverridden}
                />
              ) : null}
            </FormCard>
            {overriddenFailed ? (
              <Text style={styles.help}>
                Could not check which games you've changed — this edit will leave them exactly as
                they are.
              </Text>
            ) : null}
          </FormSection>
        ) : null}

        {series ? (
          series.ended_at === null ? (
            <FormSection
              helper={`There is no control here for a different day or a different rhythm — frequency, weekday and start date are fixed for a series. To change when this repeats, end this series and start a new one. ${
                futureCount !== null
                  ? `Ending it cancels ${futureCount} future ${futureCount === 1 ? 'game' : 'games'} in it.`
                  : 'Ending it cancels every future game in it.'
              }`}
            >
              <GhostLink
                label="Change the schedule"
                accessibilityLabel="End this series and start a new one"
                onPress={onEndSeries}
                disabled={saving}
              />
            </FormSection>
          ) : (
            <Text style={styles.help}>
              This series has already ended, so there is no schedule left to change.
            </Text>
          )
        ) : null}

        {event.status !== 'cancelled' ? (
          <GhostLink
            label="Cancel this game"
            onPress={() => setConfirming('cancelGame')}
            disabled={saving}
          />
        ) : null}
      </Screen>

      {confirming === 'discard' ? (
        <ConfirmSheet
          title="Discard your changes?"
          body="Nothing you've changed here will be saved."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={() => {
            setConfirming(null);
            leave();
          }}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === 'unseat' ? (
        <ConfirmSheet
          title={`Save and unseat ${unseatCount} ${unseatCount === 1 ? 'player' : 'players'}?`}
          body={`Removing ${removedTables.map((t) => t.label).join(' and ')} takes ${
            unseatCount === 1 ? 'the player' : 'the players'
          } seated there off their table. They'll be told.`}
          confirmLabel="Save and unseat"
          cancelLabel="Keep editing"
          onConfirm={() => {
            setConfirming(null);
            void onSave(true);
          }}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {confirming === 'cancelGame' ? (
        <ConfirmSheet
          title="Cancel this game?"
          body="Players will see it's cancelled."
          confirmLabel="Cancel game"
          cancelLabel="Keep it"
          onConfirm={() => void onCancelGame()}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: colors.neutral[700],
    paddingHorizontal: 6,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  stopLabel: { flex: 1, fontFamily: type.bodyRegular, fontSize: 15, color: colors.text },
  stopValue: { fontFamily: type.bodySemiBold, fontSize: 15, color: colors.neutral[700] },
});
