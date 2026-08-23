import { Link, Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../../components/Button';
import Card from '../../../../../components/Card';
import ErrorBanner from '../../../../../components/ErrorBanner';
import Screen from '../../../../../components/Screen';
import Tag from '../../../../../components/Tag';
import { ChevronLeftIcon } from '../../../../../components/icons';
import { canInvite, fetchClub, fetchRoster } from '../../../../../lib/clubs';
import type { Club } from '../../../../../lib/clubs';
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
 * venue (in the club's own timezone, never the device's), any notes, and
 * every table with its tier and seat count. What a member does NOT see:
 * anything resembling a booking control or a "coming soon" label for one —
 * seat booking is the next plan, and a badge promising it now is exactly
 * the kind of thing that ages badly sitting on a screen between now and
 * whenever that plan ships. A member reads this screen and closes it.
 *
 * Organizers (host or co-organizer — `canInvite`, the same test the SQL
 * functions below enforce) additionally get table management, an edit
 * link (Task 15), a cancel action, and — only on a series occurrence they
 * have personally customised — a "Reset to the series" control.
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [loadedClub, loadedEvent, loadedTables, roster] = await Promise.all([
      fetchClub(clubId),
      fetchEvent(eventId),
      fetchEventTables(eventId),
      fetchRoster(clubId),
    ]);

    setClub(loadedClub);
    setEvent(loadedEvent);
    setTablesFailed(loadedTables === null);
    setTables(loadedTables ?? []);

    // A roster fetch failure fails closed to "not an organizer" rather than
    // blanking the screen — the member-facing content above is unaffected,
    // and the worst case is a host who temporarily loses their controls
    // rather than a page that cannot render at all.
    const myRole = (roster ?? []).find(
      (m) => m.profile_id === session?.user.id,
    )?.role;
    setIsOrganizer(myRole ? canInvite(myRole) : false);

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
          : `${tables.length} ${tables.length === 1 ? 'table' : 'tables'} · ${tables.reduce(
              (sum, t) => sum + t.capacity,
              0,
            )} seats`}
      </Text>

      {tablesFailed ? (
        <Text style={styles.help}>Could not load the tables for this game.</Text>
      ) : (
        tables.map((table) => (
          <Card key={table.id}>
            <View style={styles.row}>
              <Text style={styles.tableLabel}>{table.label}</Text>
              <Text style={styles.help}>
                {table.capacity} {table.capacity === 1 ? 'seat' : 'seats'}
              </Text>
            </View>

            {isOrganizer ? (
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
            ) : (
              <Text style={styles.help}>
                {TIERS.find((t) => t.value === table.skill_tier)?.label}
              </Text>
            )}

            {isOrganizer && tables.length > 1 ? (
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
          </Card>
        ))
      )}

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
  tableLabel: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
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
