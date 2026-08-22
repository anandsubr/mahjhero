import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../components/Button';
import DateField from '../../../../components/DateField';
import ErrorBanner from '../../../../components/ErrorBanner';
import Screen from '../../../../components/Screen';
import TextField from '../../../../components/TextField';
import TimeField from '../../../../components/TimeField';
import VenuePicker from '../../../../components/VenuePicker';
import { fetchClub, type Club } from '../../../../lib/clubs';
import {
  createEvent,
  createEventSeries,
  frequencyLabel,
  nextOccurrences,
  type SeriesFrequency,
} from '../../../../lib/events';
import { useSession } from '../../../../lib/session';
import { dateToDateString } from '../../../../lib/time';
import { colors, space, type } from '../../../../lib/theme';

type Repeat = 'never' | SeriesFrequency;

const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'never', label: 'Just once' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every other week' },
  { value: 'monthly_nth_weekday', label: 'Monthly' },
];

const DURATIONS = [120, 180, 240];

/*
 * This screen converts no timezones.
 *
 * Both paths send the club-local calendar date, the wall-clock start time and
 * a duration in minutes, and Postgres resolves the instant against
 * `clubs.timezone` — `(date + time) at time zone club_tz` — for a one-off game
 * (`create_event`) exactly as it already did for every week of a series
 * (`materialize_one_series`). One conversion, in one place.
 *
 * There used to be a second implementation here, in JavaScript, because a
 * one-off event had no series row for the database to resolve from. It was
 * written twice and was wrong both times; the second attempt still disagreed
 * with Postgres in 233 of 3,920 date/time/club-zone/device-zone combinations.
 * supabase/migrations/20260823070000 gave `create_event` the same calendar
 * arguments the series functions take so that there is nothing left here to
 * disagree.
 */
export default function NewEventScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState('');
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueName, setVenueName] = useState('');
  const [date, setDate] = useState(dateToDateString(new Date()));
  const [startTime, setStartTime] = useState('19:00');
  const [duration, setDuration] = useState(180);
  const [tableCount, setTableCount] = useState(1);
  const [repeat, setRepeat] = useState<Repeat>('never');
  const [endsOn, setEndsOn] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchClub(clubId).then((result) => {
      if (cancelled) return;
      setClub(result);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clubId, session]);

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
  // sign in -- the same guard-ordering defect already fixed once on the club
  // detail screen and once in app/index.tsx's storage race.
  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!club) {
    return (
      <Screen contentStyle={styles.container}>
        <ErrorBanner message="That club could not be loaded." />
      </Screen>
    );
  }

  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  // "Monthly" means "the same weekday-of-month as the date you picked" --
  // derived rather than asked, because a host who picks the 2nd Tuesday
  // means the 2nd Tuesday, and making them say so twice is a form that does
  // not trust them.
  const nthWeek = Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;

  const preview =
    repeat === 'never'
      ? []
      : nextOccurrences(
          {
            frequency: repeat,
            weekday,
            nthWeek: repeat === 'monthly_nth_weekday' ? nthWeek : null,
            startsOn: date,
            // Passed through so the preview honours the same clamp
            // `series_occurrence_dates` applies in SQL. Leaving this out (as
            // the task brief's sample code did) lets the preview name dates
            // past the host's own stop date -- promising games the database
            // will never materialize, on the very screen that sets the
            // bound.
            endsOn: endsOn.length > 0 ? endsOn : null,
          },
          3,
        );

  async function onSave() {
    if (!venueId) {
      setError('Choose where you are playing.');
      return;
    }
    setSaving(true);
    setError(null);

    if (repeat === 'never') {
      const result = await createEvent({
        clubId,
        title,
        venueId,
        notes,
        date,
        startTime,
        durationMinutes: duration,
        tableCount,
      });
      setSaving(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.replace(`/clubs/${clubId}`);
      return;
    }

    const result = await createEventSeries({
      clubId,
      title,
      venueId,
      notes,
      frequency: repeat,
      weekday,
      nthWeek: repeat === 'monthly_nth_weekday' ? nthWeek : null,
      startTime,
      durationMinutes: duration,
      tableCount,
      startsOn: date,
      endsOn: endsOn.length > 0 ? endsOn : null,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.replace(`/clubs/${clubId}`);
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Text style={styles.heading}>Add a game</Text>

      {error ? <ErrorBanner message={error} /> : null}

      <TextField
        label="What is it called?"
        value={title}
        onChangeText={setTitle}
        accessibilityLabel="Game name"
        placeholder="Tuesday night mahjong"
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

      <Text style={styles.label}>Date</Text>
      <DateField value={date} onChange={setDate} label="Date" />

      <Text style={styles.label}>Start time</Text>
      <TimeField value={startTime} onChange={setStartTime} label="Start time" />

      <Text style={styles.label}>How long?</Text>
      <View style={styles.chips}>
        {DURATIONS.map((minutes) => (
          <Button
            key={minutes}
            variant={duration === minutes ? 'primary' : 'secondary'}
            big={false}
            onPress={() => setDuration(minutes)}
            accessibilityLabel={`${minutes / 60} hours`}
            accessibilityState={{ selected: duration === minutes }}
          >
            {`${minutes / 60} hours`}
          </Button>
        ))}
      </View>

      <Text style={styles.label}>How many tables?</Text>
      <View style={styles.chips}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Button
            key={n}
            variant={tableCount === n ? 'primary' : 'secondary'}
            big={false}
            onPress={() => setTableCount(n)}
            accessibilityLabel={`${n} ${n === 1 ? 'table' : 'tables'}`}
            accessibilityState={{ selected: tableCount === n }}
          >
            {String(n)}
          </Button>
        ))}
      </View>
      <Text style={styles.help}>
        Every table seats four, so {tableCount}{' '}
        {tableCount === 1 ? 'table is' : 'tables are'} room for{' '}
        {tableCount * 4} players.
      </Text>

      <Text style={styles.label}>Does it repeat?</Text>
      <View style={styles.chips}>
        {REPEATS.map((option) => (
          <Button
            key={option.value}
            variant={repeat === option.value ? 'primary' : 'secondary'}
            big={false}
            onPress={() => setRepeat(option.value)}
            accessibilityLabel={option.label}
            accessibilityState={{ selected: repeat === option.value }}
          >
            {option.label}
          </Button>
        ))}
      </View>

      {repeat !== 'never' ? (
        <>
          <Text style={styles.help}>
            {frequencyLabel(
              repeat,
              weekday,
              repeat === 'monthly_nth_weekday' ? nthWeek : null,
            )}
            .{' '}
            {preview.length > 0
              ? `Next: ${preview.join(', ')}`
              : 'No games would be created before that end date.'}
          </Text>
          <Text style={styles.label}>Stop repeating on (optional)</Text>
          {/*
            Empty until the host picks one, because that is what gets sent:
            `endsOn: null`. Showing the START date here instead (which this
            field used to do) put a date on screen the host never chose, and
            contradicted the preview immediately above it — which, correctly,
            listed occurrences past that date. It also made the start date the
            one value the host could not select: a controlled input already
            holding it fires no change event when you pick it again.
          */}
          <DateField value={endsOn} onChange={setEndsOn} label="Stop repeating on" />
        </>
      ) : null}

      <TextField
        label="Anything else? (optional)"
        value={notes}
        onChangeText={setNotes}
        accessibilityLabel="Notes"
        multiline
      />

      <Button onPress={onSave} loading={saving} accessibilityLabel="Save game">
        Save
      </Button>
      <Button
        variant="ghost"
        onPress={() => router.back()}
        accessibilityLabel="Cancel"
      >
        Cancel
      </Button>
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
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
