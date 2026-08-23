import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
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
import { colors, space, type } from '../../../../../lib/theme';

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
 *     That is safe because the RPC itself gates propagation on whether the
 *     value actually changed, compared against the series row it reads
 *     under `for update` (supabase/migrations/20260823040000) — resending an
 *     unchanged value is a correctly-detected no-op there.
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
  const [title, setTitle] = useState('');
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueName, setVenueName] = useState('');
  const [startTime, setStartTime] = useState('19:00');
  const [notes, setNotes] = useState('');
  const [original, setOriginal] = useState<OriginalOccurrence | null>(null);
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
        setTitle(loadedEvent.title);
        setVenueId(loadedEvent.venue_id);
        setVenueName(loadedEvent.venue_name);
        setNotes(loadedEvent.notes);
        setStartTime(initialStartTime);
        setOriginal({
          title: loadedEvent.title,
          venueId: loadedEvent.venue_id,
          notes: loadedEvent.notes,
          startTime: initialStartTime,
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

      const result = await updateEvent(event.id, {
        title: titleChanged ? title.trim() : null,
        venueId: venueChanged ? venueId : null,
        notes: notesChanged ? notes : null,
        startTime: startTimeChanged ? startTime : null,
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
            <Button
              variant={scope === 'event' ? 'primary' : 'secondary'}
              big={false}
              onPress={() => setScope('event')}
              accessibilityLabel="This game only"
              accessibilityState={{ selected: scope === 'event' }}
            >
              This game
            </Button>
            <Button
              variant={scope === 'series' ? 'primary' : 'secondary'}
              big={false}
              onPress={() => setScope('series')}
              accessibilityLabel="The whole series"
              accessibilityState={{ selected: scope === 'series' }}
            >
              The whole series
            </Button>
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
        clubId={clubId}
        value={venueId}
        valueName={venueName}
        onChange={(id, name) => {
          setVenueId(id);
          setVenueName(name);
        }}
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

      {scope === 'series' && series ? (
        <>
          <Text style={styles.label}>Stop repeating on</Text>
          {runsIndefinitely ? (
            <Text style={styles.help}>This series runs indefinitely.</Text>
          ) : (
            <DateField value={endsOn} onChange={setEndsOn} label="Stop repeating on" />
          )}
          <View style={styles.shareRow}>
            <Toggle
              value={runsIndefinitely}
              onValueChange={(next) => {
                setRunsIndefinitely(next);
                // Clears the picked date from view along with the toggle --
                // turning this back off should not silently resurrect a date
                // the host just said they don't want.
                if (next) setEndsOn('');
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
              accessibilityLabel={`Also apply this edit to the ${customised.length} games you've changed`}
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
        onPress={() => router.back()}
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
