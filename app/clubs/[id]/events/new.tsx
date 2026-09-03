import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../components/Button';
import { ChevronLeftIcon } from '../../../../components/icons';
import DateField from '../../../../components/DateField';
import ErrorBanner from '../../../../components/ErrorBanner';
import Screen from '../../../../components/Screen';
import TabBar from '../../../../components/TabBar';
import TextField from '../../../../components/TextField';
import TimeField from '../../../../components/TimeField';
import Toggle from '../../../../components/Toggle';
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
import { colors, radius, shadow, space, type } from '../../../../lib/theme';

type Repeat = 'never' | SeriesFrequency;

const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'never', label: 'Just once' },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every other week' },
  { value: 'monthly_nth_weekday', label: 'Monthly' },
];

const DURATIONS = [120, 180, 240];

/**
 * The duration/table-count/repeat rows below are chip-style selectors where
 * "which one is selected" is the entire point -- exactly the case `Button`
 * cannot serve: `Button` merges a caller's `accessibilityState` straight into
 * RN's own `accessibilityState` prop, and react-native-web's `createDOMProps`
 * has no handling for `accessibilityState` at all (see
 * components/Toggle.tsx's docstring for the full account), so the `selected`
 * value these rows used to pass as `accessibilityState={{ selected }}` never
 * reached the DOM on web. `Button` itself is not touched here -- it still has
 * no way to forward a caller's `aria-selected` to its underlying `Pressable`
 * -- so this follows the fix the organizer's own per-table tier chips already
 * established for the identical shape
 * (app/clubs/[id]/events/[eventId]/index.tsx's `TierChip`, itself following
 * `BringSomeoneSheet`'s chips): a bespoke `Pressable` carrying the flat
 * `aria-selected` prop, styled to match `Button`'s own
 * primary/secondary/big=false chip pixel-for-pixel so replacing `Button` here
 * changes no layout or visible text.
 */
function Chip({
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
        chipStyles.base,
        selected ? chipStyles.selected : chipStyles.unselected,
        pressed ? chipStyles.pressed : null,
      ]}
    >
      <Text style={selected ? chipStyles.labelSelected : chipStyles.label}>
        {children}
      </Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
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
 *
 * Carries the tab bar with `active="club"`, the same as every other
 * signed-in screen: the design source renders the bar as a sibling of every
 * `appScreens` entry, `host` included — it is not gated to the four tabs
 * themselves. The Cancel button below is NOT redundant with the Club tab and
 * stays: it returns to THIS specific club (`/clubs/${clubId}`), while the
 * Club tab goes to the clubs dashboard (`/clubs`) — different destinations,
 * unlike the `newclub` screen's dropped `← Clubs` link, which pointed at the
 * same place its tab does.
 *
 * Also carries an explicit top-of-screen back link to `/clubs`
 * (2026-09-02-club-page-games-and-back-links-design.md) — the Club tab
 * reaches that same route but renders as already-active here, which reads
 * as "you are here" rather than "go back", the same reasoning every other
 * back link on this branch documents. This is a different control from the
 * Cancel button above: "I didn't mean to be here" versus "abandon this
 * draft".
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
  /*
   * The floor under both date fields on this screen.
   *
   * A game dated in the past saves fine and then appears nowhere:
   * `fetchUpcomingEvents` filters `ends_at >= now()` and is the only events
   * listing the app has, so a mistyped year used to give a host a success
   * redirect and a game that exists only in the database. Snapshotted once
   * per mount rather than recomputed on every render -- it is a floor, not a
   * clock, and a value that changed mid-form would make the field the host is
   * looking at change under them at midnight.
   *
   * The device's own calendar day, which is not necessarily the club's. Close
   * enough for a picker; the club's zone is where the real refusal lives
   * (supabase/migrations/20260824001000).
   */
  const [today] = useState(() => dateToDateString(new Date()));
  const [startTime, setStartTime] = useState('19:00');
  const [duration, setDuration] = useState(180);
  const [tableCount, setTableCount] = useState(1);
  const [repeat, setRepeat] = useState<Repeat>('never');
  const [endsOn, setEndsOn] = useState('');
  // Off by default -- a club running two tables of eight does not need a
  // door list, and defaulting this on would teach hosts to ignore it. See
  // the help text below the toggle for the host-facing version of this.
  const [checkInRequired, setCheckInRequired] = useState(false);
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
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
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
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!club) {
    return (
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
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
        checkInRequired,
      });
      setSaving(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      // The clubs dashboard, not this specific club's own page -- a newly
      // created game already shows up there, and it matches this screen's
      // own top-of-screen back link and the Club tab, unlike the Cancel
      // button below (which deliberately stays on `/clubs/${clubId}`, see
      // this file's own docstring).
      router.replace('/clubs');
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
      checkInRequired,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Same destination as the single-event save above, for the same reason.
    router.replace('/clubs');
  }

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push('/clubs')}
        accessibilityLabel="Back to your clubs"
        style={styles.backButton}
      >
        Clubs
      </Button>

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
      <DateField value={date} onChange={setDate} label="Date" minimum={today} />

      <Text style={styles.label}>Start time</Text>
      <TimeField value={startTime} onChange={setStartTime} label="Start time" />

      <Text style={styles.label}>How long?</Text>
      <View style={styles.chips}>
        {DURATIONS.map((minutes) => (
          <Chip
            key={minutes}
            selected={duration === minutes}
            onPress={() => setDuration(minutes)}
            accessibilityLabel={`${minutes / 60} hours`}
          >
            {`${minutes / 60} hours`}
          </Chip>
        ))}
      </View>

      <Text style={styles.label}>How many tables?</Text>
      <View style={styles.chips}>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Chip
            key={n}
            selected={tableCount === n}
            onPress={() => setTableCount(n)}
            accessibilityLabel={`${n} ${n === 1 ? 'table' : 'tables'}`}
          >
            {String(n)}
          </Chip>
        ))}
      </View>
      <Text style={styles.help}>
        Every table seats four, so {tableCount}{' '}
        {tableCount === 1 ? 'table is' : 'tables are'} room for{' '}
        {tableCount * 4} players.
      </Text>

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

      <Text style={styles.label}>Does it repeat?</Text>
      <View style={styles.chips}>
        {REPEATS.map((option) => (
          <Chip
            key={option.value}
            selected={repeat === option.value}
            onPress={() => setRepeat(option.value)}
            accessibilityLabel={option.label}
          >
            {option.label}
          </Chip>
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
          <DateField
            value={endsOn}
            onChange={setEndsOn}
            label="Stop repeating on"
            minimum={today}
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
        onPress={() => {
          // A direct URL, a page reload on web, a deep link, or a cold
          // launch straight into this route leaves nothing to pop -- only
          // `back()` when there is history to unwind. The fallback replaces
          // rather than pushes: a pushed club screen would leave this
          // cancelled form one browser-back away, a stale entry the member
          // could stumble straight back into.
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace(`/clubs/${clubId}`);
          }
        }}
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
  backButton: { alignSelf: 'flex-start' },
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
