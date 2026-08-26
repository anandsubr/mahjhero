import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../../components/Button';
import Card from '../../../../../components/Card';
import DateField from '../../../../../components/DateField';
import ErrorBanner from '../../../../../components/ErrorBanner';
import Screen from '../../../../../components/Screen';
import TextField from '../../../../../components/TextField';
import TimeField from '../../../../../components/TimeField';
import Toggle from '../../../../../components/Toggle';
import VenuePicker from '../../../../../components/VenuePicker';
import { fetchClub, type Club } from '../../../../../lib/clubs';
import {
  endEventSeries,
  eventStartTimeInZone,
  fetchEvent,
  fetchFutureOccurrenceCount,
  fetchOverriddenOccurrences,
  fetchSeries,
  formatEventWhen,
  frequencyLabel,
  updateEvent,
  updateEventSeries,
  type ClubEvent,
  type EventSeries,
} from '../../../../../lib/events';
import { useSession } from '../../../../../lib/session';
import { dateToDateString } from '../../../../../lib/time';
import { colors, radius, shadow, space, type } from '../../../../../lib/theme';

type Scope = 'event' | 'series';

/** The single occurrence's own values, snapshotted once on load, so the
 * "This game" save path can tell what actually changed and send only that —
 * see the file-level comment above `onSave` for why that matters here in a
 * way it does not for the series path. */
type OriginalOccurrence = {
  title: string;
  venueId: string;
  notes: string;
  startTime: string;
  checkInRequired: boolean;
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

/**
 * The "This game" / "The whole series" scope chooser below is the control
 * that decides whether a save touches one night or rewrites every future
 * week of a recurring series -- so a screen reader that cannot tell which
 * one is currently selected is not a cosmetic gap here. `Button` cannot
 * carry that state to the DOM: it merges a caller's `accessibilityState`
 * straight into RN's own `accessibilityState` prop, and react-native-web's
 * `createDOMProps` has no handling for `accessibilityState` at all (see
 * components/Toggle.tsx's docstring for the full account), so the `selected`
 * value this control used to pass as `accessibilityState={{ selected }}`
 * never reached the DOM on web. `Button` itself is not touched here -- it
 * still has no way to forward a caller's `aria-selected` to its underlying
 * `Pressable` -- so this follows the fix already established for the
 * identical shape by the organizer's per-table tier chips
 * (app/clubs/[id]/events/[eventId]/index.tsx's `TierChip`) and this event's
 * own duration/table-count/repeat rows (app/clubs/[id]/events/new.tsx's
 * `Chip`): a bespoke `Pressable` carrying the flat `aria-selected` prop,
 * styled to match `Button`'s own primary/secondary/big=false chip
 * pixel-for-pixel so replacing `Button` here changes no layout or visible
 * text.
 */
function ScopeChip({
  children,
  selected,
  onPress,
  accessibilityLabel,
}: {
  children: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      aria-selected={selected}
      style={({ pressed }) => [
        scopeChipStyles.base,
        selected ? scopeChipStyles.selected : scopeChipStyles.unselected,
        pressed ? scopeChipStyles.pressed : null,
      ]}
    >
      <Text
        style={selected ? scopeChipStyles.labelSelected : scopeChipStyles.label}
      >
        {children}
      </Text>
    </Pressable>
  );
}

const scopeChipStyles = StyleSheet.create({
  // Matches components/Button.tsx's `base` + `regular` (big=false) exactly.
  base: {
    borderRadius: radius.pill,
    minHeight: 46,
    paddingHorizontal: space[5],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  // Matches Button's `variantStyles.primary`.
  selected: {
    backgroundColor: colors.accentColor,
    borderColor: 'transparent',
    ...shadow.sm,
  },
  // Matches Button's `variantStyles.secondary`.
  unselected: {
    backgroundColor: colors.surface,
    borderColor: colors.divider,
  },
  // Matches Button's `pressed`.
  pressed: {
    opacity: 0.85,
  },
  // Matches Button's `label` + `variantTextStyles.primary`.
  labelSelected: {
    fontFamily: type.heading,
    fontSize: type.size.body,
    color: colors.bg,
  },
  // Matches Button's `label` + `variantTextStyles.secondary`.
  label: {
    fontFamily: type.heading,
    fontSize: type.size.body,
    color: colors.text,
  },
});

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
  const [eventStartTime, setEventStartTime] = useState('19:00');
  const [eventNotes, setEventNotes] = useState('');
  const [eventCheckInRequired, setEventCheckInRequired] = useState(false);
  const [original, setOriginal] = useState<OriginalOccurrence | null>(null);

  const [seriesTitle, setSeriesTitle] = useState('');
  const [seriesVenueId, setSeriesVenueId] = useState<string | null>(null);
  const [seriesVenueName, setSeriesVenueName] = useState('');
  const [seriesStartTime, setSeriesStartTime] = useState('19:00');
  const [seriesNotes, setSeriesNotes] = useState('');
  const [seriesCheckInRequired, setSeriesCheckInRequired] = useState(false);
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

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    (async () => {
      const [loadedClub, loadedEvent] = await Promise.all([
        fetchClub(clubId),
        fetchEvent(eventId),
      ]);
      if (cancelled) return;

      setClub(loadedClub);
      setEvent(loadedEvent);

      if (loadedEvent && loadedClub) {
        const initialStartTime = eventStartTimeInZone(
          loadedEvent.starts_at,
          loadedClub.timezone,
        );
        setEventTitle(loadedEvent.title);
        setEventVenueId(loadedEvent.venue_id);
        setEventVenueName(loadedEvent.venue_name);
        setEventNotes(loadedEvent.notes);
        setEventStartTime(initialStartTime);
        setEventCheckInRequired(loadedEvent.check_in_required);
        setOriginal({
          title: loadedEvent.title,
          venueId: loadedEvent.venue_id,
          notes: loadedEvent.notes,
          startTime: initialStartTime,
          checkInRequired: loadedEvent.check_in_required,
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
  // checking `!ready` first would strand them on a spinner instead of
  // sending them to sign in -- this exact ordering bug has now appeared in
  // three separate briefs for this branch, this task's own included (its
  // Step 1 sample put the checks in the wrong order).
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

  // A game whose stored start time cannot be parsed cannot be edited: the
  // form's TimeField has no honest way to show an unknown time. On web it
  // would render empty, but the native picker has no empty state — it falls
  // back to midnight (lib/time.ts's timeStringToDate), shows a plausible
  // "12:00 AM", and a host who merely confirms the dialog saves a midnight
  // nobody chose over the real value. Refusing the whole form is the only
  // answer that cannot lose the stored time.
  if (Number.isNaN(new Date(event.starts_at).getTime())) {
    return (
      <Screen contentStyle={styles.container}>
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

  // Arrow functions assigned to `const`, not `function` declarations --
  // TypeScript only carries the `!club || !event` narrowing above into a
  // nested closure when it can prove the captured binding is never
  // reassigned, and a hoisted function declaration doesn't give it that
  // guarantee the way a const-bound closure defined after the guard does.
  const onSave = async () => {
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

      const result = await updateEventSeries(series.id, {
        title,
        venueId,
        notes,
        startTime,
        checkInRequired,
        endsOn: endsOnInput,
        clearEndsOn,
        includeOverridden,
      });
      setSaving(false);
      if (result.error) {
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
      const checkInChanged = original
        ? checkInRequired !== original.checkInRequired
        : false;

      const result = await updateEvent(event.id, {
        title: titleChanged ? title.trim() : null,
        venueId: venueChanged ? venueId : null,
        notes: notesChanged ? notes : null,
        startTime: startTimeChanged ? startTime : null,
        checkInRequired: checkInChanged ? checkInRequired : null,
      });
      setSaving(false);
      if (result.error) {
        setError(result.error);
        return;
      }
    }

    router.replace(`/clubs/${clubId}/events/${eventId}`);
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

  return (
    <Screen scroll contentStyle={styles.container}>
      <Text style={styles.heading}>Edit</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {event.series_id && seriesFailed ? (
        <ErrorBanner message="Could not load this game's series. You can still edit this game on its own." />
      ) : null}

      {series ? (
        <>
          <Text style={styles.label}>What are you changing?</Text>
          <View style={styles.chips}>
            <ScopeChip
              selected={scope === 'event'}
              onPress={() => setScope('event')}
              accessibilityLabel="This game only"
            >
              This game
            </ScopeChip>
            <ScopeChip
              selected={scope === 'series'}
              onPress={() => setScope('series')}
              accessibilityLabel="The whole series"
            >
              The whole series
            </ScopeChip>
          </View>
          <Text style={styles.help}>
            {frequencyLabel(series.frequency, series.weekday, series.nth_week)}
          </Text>
        </>
      ) : null}

      <TextField
        label="What is it called?"
        value={title}
        onChangeText={setTitle}
        accessibilityLabel="Game name"
      />

      <VenuePicker
        // VenuePicker seeds its own internal search text from `valueName`
        // only on mount (it does not resync when the prop later changes --
        // see its own props doc) -- so switching scope needs a fresh
        // instance to show the newly-active snapshot's venue instead of
        // going on displaying whichever scope was showing when it first
        // mounted.
        key={isSeriesScope ? 'series' : 'event'}
        clubId={clubId}
        value={venueId}
        valueName={venueName}
        onChange={setVenue}
      />

      <Text style={styles.label}>Start time</Text>
      <TimeField value={startTime} onChange={setStartTime} label="Start time" />

      <TextField
        label="Anything else? (optional)"
        value={notes}
        onChangeText={setNotes}
        accessibilityLabel="Notes"
        multiline
      />

      <Text style={styles.label}>Require check-in</Text>
      <Toggle
        value={checkInRequired}
        onValueChange={setCheckInRequired}
        accessibilityLabel="Require check-in"
      />
      <Text style={styles.help}>
        Turn this on and this game gets a door list, so you can check people
        in as they arrive. Small games usually don't need it.
      </Text>

      {scope === 'series' && series ? (
        <>
          <Text style={styles.label}>Stop repeating on</Text>
          {runsIndefinitely ? (
            <Text style={styles.help}>This series runs indefinitely.</Text>
          ) : (
            <DateField
              value={endsOn}
              onChange={setEndsOn}
              label="Stop repeating on"
              // Today, for the same reason the create screen passes it: an
              // end date in the past is a date this screen should not offer.
              // It is not refused by the database -- pulling a run's end back
              // to a past date legitimately means "this series is over", and
              // update_event_series has no past guard
              // (supabase/migrations/20260824001000 says why) -- but it does
              // now DELETE every future week beyond it
              // (supabase/migrations/20260824000000), so a mistyped year here
              // would silently clear the whole run. The picker declining to
              // offer the day is where that mistake is cheapest to stop.
              minimum={today}
            />
          )}
          <View style={styles.shareRow}>
            <Toggle
              value={runsIndefinitely}
              onValueChange={(next) => {
                setRunsIndefinitely(next);
                if (next) {
                  // Clears the picked date from view along with the toggle
                  // -- turning this back off should not silently resurrect
                  // a date the host just said they don't want.
                  setEndsOn('');
                } else {
                  // Restores the series' own end date. Leaving `endsOn`
                  // at '' here would show an empty DateField while
                  // `series.ends_on` is still set -- onSave then sends
                  // neither `endsOnInput` nor `clearEndsOn`, so the series
                  // silently keeps the end date the screen just told the
                  // host it no longer had.
                  setEndsOn(series?.ends_on ?? '');
                }
              }}
              accessibilityLabel="Runs indefinitely, with no end date"
            />
            <Text style={styles.help}>
              Runs indefinitely, with no end date. Turn this off to set one.
            </Text>
          </View>
        </>
      ) : null}

      {/*
        Only rendered when there is something for it to apply to. A toggle
        offering to overwrite nothing is a question the host cannot answer
        wrong and should not have to read. Its copy describes exactly what it
        does -- apply THIS edit to the weeks you've customised -- and nothing
        broader: fields this edit did not touch keep their overrides either
        way (supabase/migrations/20260823040000).
      */}
      {scope === 'series' && series && !overriddenFailed && customised.length > 0 ? (
        <Card>
          <View style={styles.shareRow}>
            <Toggle
              value={includeOverridden}
              onValueChange={setIncludeOverridden}
              accessibilityLabel={`Also apply this edit to the ${customised.length} ${
                customised.length === 1 ? 'game' : 'games'
              } you've changed`}
            />
            <Text style={styles.help}>
              {customised.length <= 3
                ? `Also apply this edit to the ${customised.length} ${
                    customised.length === 1 ? 'game' : 'games'
                  } you've changed — ${customised
                    .map((e) => formatEventWhen(e.starts_at, club.timezone))
                    .join(', ')}.`
                : `Also apply this edit to the ${customised.length} games you've changed.`}{' '}
              Cancelled games are never affected.
            </Text>
          </View>
        </Card>
      ) : null}
      {scope === 'series' && series && overriddenFailed ? (
        <Text style={styles.help}>
          Could not check which games you've changed — this edit will leave
          them exactly as they are.
        </Text>
      ) : null}

      <Button onPress={onSave} loading={saving} accessibilityLabel="Save changes">
        Save
      </Button>
      <Button
        variant="ghost"
        onPress={() => {
          // A direct URL, a page reload on web, a deep link, or a cold
          // launch straight into this route leaves nothing to pop -- only
          // `back()` when there is history to unwind. The fallback replaces
          // rather than pushes: a pushed event screen would leave this
          // cancelled form one browser-back away, a stale entry the member
          // could stumble straight back into.
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace(`/clubs/${clubId}/events/${eventId}`);
          }
        }}
        accessibilityLabel="Cancel"
      >
        Cancel
      </Button>

      {series ? (
        series.ended_at === null ? (
          <Card>
            <Text style={styles.help}>
              There is no control here for a different day or a different
              rhythm — frequency, weekday and start date are fixed for a
              series. To change when this repeats, end this series and start
              a new one.{' '}
              {futureCount !== null
                ? `Ending it cancels ${futureCount} future ${
                    futureCount === 1 ? 'game' : 'games'
                  } in it.`
                : 'Ending it cancels every future game in it.'}
            </Text>
            <Button
              variant="ghost"
              onPress={onEndSeries}
              disabled={saving}
              accessibilityLabel="End this series and start a new one"
            >
              Change the schedule
            </Button>
          </Card>
        ) : (
          <Text style={styles.help}>
            This series has already ended, so there is no schedule left to
            change.
          </Text>
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  label: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.textLabel,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
  },
  help: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
