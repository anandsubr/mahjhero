import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import DateField from '../../../../components/DateField';
import ErrorBanner from '../../../../components/ErrorBanner';
import {
  ActionBar,
  ChipsRow,
  ConfirmSheet,
  FormCard,
  FormHeader,
  FormSection,
  FormTitle,
  MoneyCards,
  Segmented,
  SmallChip,
  StartTimeRow,
  TablesCard,
  TextRow,
  ToggleRow,
  formStyles,
} from '../../../../components/GameForm';
import { ClipboardCheckIcon, LockIcon } from '../../../../components/icons';
import Screen from '../../../../components/Screen';
import TabBar from '../../../../components/TabBar';
import TimeField from '../../../../components/TimeField';
import TipCard, { TipText } from '../../../../components/TipCard';
import VenuePicker from '../../../../components/VenuePicker';
import type { SkillTier } from '../../../../lib/bookings';
import { fetchClub, fetchMyRoles, type Club, type GameMode } from '../../../../lib/clubs';
import {
  createEvent,
  createEventSeries,
  fetchEventTables,
  frequencyLabel,
  nextOccurrences,
  parseDollarsToCents,
  updateEventTable,
  type SeatingMode,
  type SeriesFrequency,
} from '../../../../lib/events';
import { useGuides } from '../../../../lib/use-guides';
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
 * The optional capacity field's parse boundary -- mirrors lib/events.ts's
 * own `parseDollarsToCents` in shape (blank text in, a clean value or a
 * refusal out) but is not a currency value and is not exported from there,
 * since only this screen and its edit-form twin need it. Blank means "no
 * limit", matching `createEvent`'s own `capacity: null` convention.
 *
 * Finding #5 of the final review: this used to map ANY non-numeric text to
 * `null` too, the same as blank -- degrading `NaN` rather than sending it
 * to the RPC was the right instinct, but conflating "unparseable" (a typo,
 * `6o` for `60`) with "deliberately left blank" was not. An organizer who
 * meant to keep a 60-person cap and fat-fingered `6o` instead had it
 * silently removed on save, with no error and no confirmation. This now
 * returns a third state for that case, and `onSave` below refuses to save
 * rather than guessing.
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
 * Game form handoff: no tab bar once the form is up -- the header's ✕ and
 * the pinned Cancel both leave, asking first if anything was changed.
 * Leaving goes back where the host came from, or to this club's own page
 * when there is no history (a direct URL, a reload, a deep link).
 */
export default function NewEventScreen() {
  const { id: clubId } = useLocalSearchParams<{ id: string }>();
  const { session, loading } = useSession();
  const guides = useGuides();
  const router = useRouter();

  const [club, setClub] = useState<Club | null>(null);
  const [isHost, setIsHost] = useState(false);
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
  // One entry per table, holding its level. Its length is the table count.
  const [tableTiers, setTableTiers] = useState<SkillTier[]>(['mixed']);
  const tableCount = tableTiers.length;
  // Defaults to the app's existing behaviour -- every event before this
  // task shipped assigned tables, and `create_event`/`create_event_series`
  // themselves default here too, so an unmounted-then-remounted form (or a
  // test that never touches this control) still sends exactly what it
  // always did.
  const [seatingMode, setSeatingMode] = useState<SeatingMode>('assigned_tables');
  const [capacityText, setCapacityText] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('never');
  const [endsOn, setEndsOn] = useState('');
  // Off by default -- a club running two tables of eight does not need a
  // door list, and defaulting this on would teach hosts to ignore it. See
  // the help text below the toggle for the host-facing version of this.
  const [checkInRequired, setCheckInRequired] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('open_play');
  const [feeText, setFeeText] = useState('');
  const [minSpendText, setMinSpendText] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // Everything the host can change, for "has anything been changed?". The
  // baseline is taken once the club (and with it the default game mode) has
  // loaded, so that seeding is not mistaken for an edit.
  const formSnapshot = JSON.stringify([
    title, venueId, date, startTime, duration, tableTiers, seatingMode, capacityText,
    repeat, endsOn, checkInRequired, gameMode, feeText, minSpendText, notes,
  ]);
  const baselineRef = useRef<string | null>(null);
  useEffect(() => {
    if (ready && baselineRef.current === null) baselineRef.current = formSnapshot;
  }, [ready, formSnapshot]);
  const dirty = baselineRef.current !== null && baselineRef.current !== formSnapshot;

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    Promise.all([fetchClub(clubId), fetchMyRoles(session.user.id)]).then(
      ([result, roles]) => {
        if (cancelled) return;
        setClub(result);
        if (result) setGameMode(result.default_game_mode);
        setIsHost(roles?.some((r) => r.club_id === clubId && r.role === 'host') ?? false);
        setReady(true);
      },
    );
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

  // Mirrors the dashboard's own `canAddGames` gate (app/clubs/index.tsx):
  // reaching this screen by URL used to show the full form to any member,
  // even though create_event's own organizer check would always reject
  // their submit. Host-only, not canInvite's broader host-or-co-organizer --
  // there is no UI yet to grant co_organizer to anyone, so this stays
  // reserved for whoever actually created the club until a real cohost
  // feature exists to extend it deliberately.
  if (!isHost) return <Redirect href={`/clubs/${clubId}`} />;

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
    // Refuse an unparseable capacity outright, before touching the network
    // -- see parseCapacity's own doc for the typo (`6o` for `60`) this
    // guards against. Checked ahead of `setSaving(true)` so a refusal never
    // shows a spinner.
    const capacityParsed = parseCapacity(capacityText);
    if (!capacityParsed.valid) {
      setError(INVALID_CAPACITY_MESSAGE);
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
        // Open seating materializes no tables at all -- who turns up is not
        // known until the door, so there is nothing to pre-assign. The chip
        // above is what decides this; `tableCount` itself still reflects
        // whatever the (now hidden) tables picker last held, which this
        // must NOT send when open seating is chosen.
        tableCount: seatingMode === 'open_seating' ? 0 : tableCount,
        checkInRequired,
        gameMode,
        feeCents: parseDollarsToCents(feeText),
        minSpendCents: parseDollarsToCents(minSpendText),
        seatingMode,
        capacity: capacityParsed.value,
      });
      if (result.error || !result.eventId) {
        setSaving(false);
        setError(result.error);
        return;
      }
      // `create_event` makes every table "Any level"; any other level picked
      // here is applied to the new tables afterwards, in position order.
      if (seatingMode === 'assigned_tables' && tableTiers.some((t) => t !== 'mixed')) {
        const created = await fetchEventTables(result.eventId);
        const ordered = [...(created ?? [])].sort((a, b) => a.position - b.position);
        const writes = await Promise.all(
          ordered.map((table, index) =>
            tableTiers[index] && tableTiers[index] !== 'mixed'
              ? updateEventTable(table.id, { tier: tableTiers[index] })
              : Promise.resolve({ error: null }),
          ),
        );
        if (created === null || writes.some((w) => w.error)) {
          // The game exists; only its levels did not land. Send the host to
          // its edit screen, where they can set them, rather than offering a
          // Save that would create the game a second time.
          setSaving(false);
          router.replace(`/clubs/${clubId}/events/${result.eventId}/edit`);
          return;
        }
      }
      setSaving(false);
      // The clubs dashboard, not this specific club's own page -- a newly
      // created game already shows up there.
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
      // Same reasoning as the one-off path above -- an open-seating series
      // materializes zero tables for every occurrence it produces.
      tableCount: seatingMode === 'open_seating' ? 0 : tableCount,
      startsOn: date,
      endsOn: endsOn.length > 0 ? endsOn : null,
      checkInRequired,
      gameMode,
      feeCents: parseDollarsToCents(feeText),
      minSpendCents: parseDollarsToCents(minSpendText),
      seatingMode,
      capacity: capacityParsed.value,
    });
    setSaving(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    // Same destination as the single-event save above, for the same reason.
    router.replace('/clubs');
  }

  function leave() {
    // A direct URL, a page reload on web, a deep link, or a cold launch
    // straight into this route leaves nothing to pop -- only `back()` when
    // there is history to unwind. The fallback replaces rather than pushes:
    // a pushed club screen would leave this cancelled form one browser-back
    // away, a stale entry the member could stumble straight back into.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/clubs/${clubId}`);
    }
  }

  function requestLeave() {
    if (dirty) setConfirmingDiscard(true);
    else leave();
  }

  const repeating = repeat !== 'never';

  return (
    <>
      <Screen
        scroll
        contentStyle={formStyles.body}
        tabBar={
          <ActionBar
            onCancel={requestLeave}
            primaryLabel="Create game"
            primaryAccessibilityLabel="Save game"
            onPrimary={onSave}
            busy={saving}
          />
        }
      >
        <FormHeader clubId={clubId} clubName={club.name} onClose={requestLeave} />
        <FormTitle>New game</FormTitle>

        {error ? <ErrorBanner message={error} /> : null}

        {guides.isVisible('tip:new-game') ? (
          <TipCard tag="Tip" title="Setting up a game" onDismiss={() => guides.dismiss('tip:new-game')}>
            <TipText>Assigned tables: players pick an Empty seat at a table.</TipText>
            <TipText>Open seating: players tap Join, and no tables are set in advance.</TipText>
            <TipText>
              Set Cost to play, and Minimum spend if the venue asks for one. Players see the
              cost up front, and you mark who's paid at check-in. No money goes through the app.
            </TipText>
          </TipCard>
        ) : null}

        <FormSection label="Details">
          <FormCard>
            <TextRow
              label="What is it called?"
              value={title}
              onChangeText={setTitle}
              accessibilityLabel="Game name"
              placeholder="Tuesday night mahjong"
            />
            <VenuePicker
              variant="row"
              clubId={clubId}
              value={venueId}
              valueName={venueName}
              onChange={(id, name) => {
                setVenueId(id);
                setVenueName(name);
              }}
            />
            <StartTimeRow>
              <DateField value={date} onChange={setDate} label="Date" minimum={today} compact />
              <TimeField value={startTime} onChange={setStartTime} label="Start time" compact />
            </StartTimeRow>
            <ChipsRow label="How long?">
              {DURATIONS.map((minutes) => (
                <SmallChip
                  key={minutes}
                  label={`${minutes / 60} hours`}
                  selected={duration === minutes}
                  onPress={() => setDuration(minutes)}
                />
              ))}
            </ChipsRow>
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
          label="Does it repeat?"
          helper={
            repeating
              ? `${frequencyLabel(
                  repeat,
                  weekday,
                  repeat === 'monthly_nth_weekday' ? nthWeek : null,
                )}. ${
                  preview.length > 0
                    ? `Next: ${preview.join(', ')}`
                    : 'No games would be created before that end date.'
                }`
              : null
          }
        >
          <FormCard>
            <View style={styles.repeatChips}>
              {REPEATS.map((option) => (
                <SmallChip
                  key={option.value}
                  label={option.label}
                  selected={repeat === option.value}
                  onPress={() => setRepeat(option.value)}
                />
              ))}
            </View>
            {repeating ? (
              // Empty until the host picks one, because that is what gets
              // sent: `endsOn: null`. Showing the START date here instead
              // put a date on screen the host never chose.
              <View style={styles.stopRow}>
                <Text style={styles.stopLabel}>Stop repeating on (optional)</Text>
                <DateField
                  value={endsOn}
                  onChange={setEndsOn}
                  label="Stop repeating on"
                  minimum={today}
                  compact
                />
              </View>
            ) : null}
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

        {seatingMode === 'assigned_tables' ? (
          <TablesCard
            tables={tableTiers.map((tier, index) => ({
              key: String(index),
              label: `Table ${index + 1}`,
              tier,
            }))}
            onAdd={() => setTableTiers((current) => [...current, 'mixed'])}
            onRemove={() => setTableTiers((current) => current.slice(0, -1))}
            onTierChange={(index, tier) =>
              setTableTiers((current) => current.map((t, i) => (i === index ? tier : t)))
            }
            max={6}
            // A series makes its tables week by week, each "Any level";
            // levels are then set per game, from its own Edit screen.
            levels={!repeating}
            note={
              repeating
                ? `Room for ${tableCount * 4} players. Set each table's level from a game's Edit screen once it's created.`
                : `Every table seats four: room for ${tableCount * 4} players.`
            }
          />
        ) : (
          // No tables at all -- who turns up to an open-seating night is not
          // known until the door, so there is nothing to pre-assign. This cap
          // limits confirmed players directly, and is entirely optional.
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
        )}

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
      </Screen>

      {confirmingDiscard ? (
        <ConfirmSheet
          title="Discard this game?"
          body="You'll lose what you've filled in."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={() => {
            setConfirmingDiscard(false);
            leave();
          }}
          onCancel={() => setConfirmingDiscard(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  repeatChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
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
});
