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

/**
 * Turns a club-local calendar date and wall-clock time into an instant, in
 * the CLUB's timezone rather than the device's.
 *
 * A series has a `starts_on` date and a `start_time` and lets Postgres do
 * this conversion server-side (`(occurrence_date + start_time) at time zone
 * club_tz` — see
 * supabase/migrations/20260823040000_series_propagation_gate_and_ended_at.sql).
 * A one-off event has no series row for anything to resolve from, so this is
 * the one instant this app computes client-side, and it has to agree with
 * that same Postgres expression exactly.
 *
 * The task brief's sample implementation compared `local.toLocaleString(tz)`
 * against `local` directly — a single conversion. That is wrong in a way
 * `npm test` (pinned to `TZ=America/New_York`) cannot catch by accident: the
 * missing term is the DEVICE's own UTC offset, which cancels out of the
 * subtraction only when the device happens to share the club's zone (or sits
 * at UTC). For every other case — a host creating a game while travelling,
 * which is the exact scenario this function exists for — the old version was
 * off by precisely the device's offset. Confirmed by hand for
 * device=America/New_York, club=America/New_York (old code returned 19:00Z
 * for a 7pm EDT game instead of the correct 23:00Z) and again for
 * device=America/New_York, club=Asia/Tokyo (old code landed a whole day off).
 *
 * The fix builds ONE device-local instant carrying the picked digits, then
 * compares it to itself re-read through the club's zone. Both readings share
 * the same device offset, so the subtraction cancels it algebraically rather
 * than by coincidence — the result depends only on the club's offset, which
 * is what `AT TIME ZONE` uses too.
 */
function clubInstant(date: string, time: string, timezone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  // A device-local Date whose wall-clock digits are exactly what the host
  // picked. Its own instant is not the answer -- the device's timezone has
  // nothing to do with what the host meant -- it exists only so the next
  // line can measure how far the CLUB's timezone reads those same digits
  // from here.
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  const zoned = new Date(local.toLocaleString('en-US', { timeZone: timezone }));
  const offset = local.getTime() - zoned.getTime();
  return new Date(local.getTime() + offset).toISOString();
}

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

  // Captured into its own const rather than read as `club.timezone` inside
  // `onSave` below: `club` is `useState`-typed as `Club | null`, and
  // TypeScript does not carry the `if (!club) return` narrowing above into a
  // nested function declaration (onSave could in principle run after a
  // later render, so the narrowing isn't sound there). This const's own type
  // is `string`, so it stays narrowed inside the closure.
  const clubTimezone = club.timezone;

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
      const startsAt = clubInstant(date, startTime, clubTimezone);
      const endsAt = new Date(
        new Date(startsAt).getTime() + duration * 60_000,
      ).toISOString();
      const result = await createEvent({
        clubId,
        title,
        venueId,
        notes,
        startsAt,
        endsAt,
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
          <DateField
            value={endsOn.length > 0 ? endsOn : date}
            onChange={setEndsOn}
            label="Stop repeating on"
          />
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
