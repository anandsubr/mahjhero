import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../../components/Button';
import Card from '../../../../../components/Card';
import CheckInControl from '../../../../../components/CheckInControl';
import ErrorBanner from '../../../../../components/ErrorBanner';
import Screen from '../../../../../components/Screen';
import {
  attendanceSummary,
  checkInOpen,
  clearAttendance,
  fetchEventAttendance,
  recordAttendance,
  type AttendanceRow,
  type AttendanceState,
} from '../../../../../lib/attendance';
import { canInvite, fetchRoster, type ClubMember } from '../../../../../lib/clubs';
import { fetchEvent } from '../../../../../lib/events';
import { useSession } from '../../../../../lib/session';
import { addHours } from '../../../../../lib/time';
import { colors, space, type } from '../../../../../lib/theme';

type TableGroup = { id: string; label: string; rows: AttendanceRow[] };

/**
 * Splits the server's own ordering into the screen's three groups —
 * per-table, "any table", and "walk-ins" — WITHOUT re-sorting. `rows`
 * arrives already ordered `(table_position nulls last, display_name,
 * profile_id)` by `event_attendance` (20260827060000); re-sorting here
 * would let this screen and that function disagree about where somebody
 * sits. `Map` preserves first-insertion order, so `Array.from(...values())`
 * below yields tables in the same order the rows already carry.
 */
function groupRows(rows: AttendanceRow[]) {
  const tables = new Map<string, TableGroup>();
  const anyTable: AttendanceRow[] = [];
  const walkIns: AttendanceRow[] = [];

  for (const r of rows) {
    // A walk-in (no confirmed booking) is checked FIRST — an organizer-added
    // walk-in row is optimistically inserted with event_table_id null too,
    // and this ordering is what keeps it out of "Any table" (which is only
    // ever a CONFIRMED booking not yet placed).
    if (r.booking_status === null) {
      walkIns.push(r);
    } else if (r.event_table_id === null) {
      anyTable.push(r);
    } else {
      const group = tables.get(r.event_table_id) ?? {
        id: r.event_table_id,
        label: r.table_label ?? 'Table',
        rows: [],
      };
      group.rows.push(r);
      tables.set(r.event_table_id, group);
    }
  }

  return { tables: Array.from(tables.values()), anyTable, walkIns };
}

/**
 * Folds a fresh server read into the rows already on screen without
 * discarding an optimistic write that has not landed yet.
 *
 * Why this exists: a refusal refetches (see `setState`/`addWalkIn` below,
 * where a failed write calls `load()`) because the server is authoritative
 * once something has gone wrong. But that refetch can resolve WHILE A
 * DIFFERENT PERSON'S write is still on the wire — the host taps Ann, then
 * Bob; Ann's write is refused and its refetch comes back before Bob's write
 * has committed. A plain `setRows(serverRows)` would replace Bob's
 * optimistic "arrived" with the server's still-stale "not yet", and since
 * Bob's write goes on to succeed silently (the success path re-renders
 * nothing, because it thinks nothing changed), Bob sits on screen as
 * unaccounted — while the server already has him arrived — until somebody
 * manually reloads.
 *
 * `busyMap` is `busy` at the moment the merge runs (not at the moment
 * `load()` was called): any row still marked busy right now has a write in
 * flight whose outcome the server read cannot yet reflect, so its LOCAL
 * value wins over the server's. A row that is busy but entirely absent from
 * the server response (an optimistic walk-in insert whose write has not
 * committed yet) is kept outright rather than dropped.
 */
function mergeAttendance(
  serverRows: AttendanceRow[],
  currentRows: AttendanceRow[],
  busyMap: Record<string, boolean>,
): AttendanceRow[] {
  const currentById = new Map(currentRows.map((r) => [r.profile_id, r]));
  const merged = serverRows.map((r) =>
    busyMap[r.profile_id] ? (currentById.get(r.profile_id) ?? r) : r,
  );
  const serverIds = new Set(serverRows.map((r) => r.profile_id));
  for (const r of currentRows) {
    if (busyMap[r.profile_id] && !serverIds.has(r.profile_id)) {
      merged.push(r);
    }
  }
  return merged;
}

/**
 * The organizer's door screen: the list a host works down while people walk
 * in, tapping "Here" or "Not coming" as they go.
 *
 * Gated on `isOrganizer`, derived the same way
 * app/clubs/[id]/events/[eventId]/index.tsx:113 does it (`canInvite` on the
 * caller's own roster row), and failing closed to "not an organizer" the
 * same way that screen does when the roster fetch itself fails — a plain
 * member never sees anyone's attendance, deliberately: arrival state is
 * operational, not something the whole roster gets to read
 * (event_attendance's own docstring says the same).
 *
 * The window (`checkInOpen`, lib/attendance.ts) only gates the CONTROLS,
 * never the read: an organizer can open this months later and still see the
 * record, exactly as event_attendance's own comment insists
 * ("READS ARE NOT WINDOW-BOUND").
 */
export default function CheckInScreen() {
  const { id: clubId, eventId } = useLocalSearchParams<{
    id: string;
    eventId: string;
  }>();
  const { session, loading } = useSession();

  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [roster, setRoster] = useState<ClubMember[]>([]);
  const [isOrganizer, setIsOrganizer] = useState(false);
  // Null means "no event loaded yet" (or the event fetch failed) --
  // `checkInOpen(null, null)` reads that the same way it reads an event
  // that never asked for check-in: closed, controls disabled. A safe
  // default; it never opens a window that doesn't exist.
  const [opensAt, setOpensAt] = useState<string | null>(null);
  const [closesAt, setClosesAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-profile, not screen-wide: one slow write must not freeze the other
  // fifteen rows a host is tapping down at the door.
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  // `fetchEventAttendance`/`fetchEvent` return null on failure the same way
  // they return an empty/absent result on success -- `?? []` used to
  // collapse those two into the same rendered screen ("0 of 0 here", empty
  // tables, no error) with nothing telling a host their network actually
  // dropped. These two flags are what let the render below tell "loaded and
  // empty" apart from "failed to load" and say something true in each case,
  // the same distinction tablesFailed/seatingFailed/rosterFailed draw on
  // index.tsx.
  const [attendanceFailed, setAttendanceFailed] = useState(false);
  const [eventFailed, setEventFailed] = useState(false);

  // A monotonically increasing tag on every `load()` call. Guards against
  // two refetches racing out of order: two refusals in a row each fire
  // their own `load()`, and without this the one that happens to RESOLVE
  // last would win even if it was the one that STARTED first, applying
  // stale data over fresh. Only the most-recently-STARTED call is allowed
  // to write its result back.
  const loadSeqRef = useRef(0);
  // Mirrors `busy` synchronously (state updates are batched/async; this
  // ref is not) so `load()`'s merge below always sees which rows have a
  // write in flight AT THE MOMENT ITS RESPONSE ARRIVES, not at the moment
  // it was called.
  const busyRef = useRef<Record<string, boolean>>({});

  function setBusyFlag(profileId: string, value: boolean) {
    busyRef.current = { ...busyRef.current, [profileId]: value };
    setBusy(busyRef.current);
  }

  async function load() {
    const seq = ++loadSeqRef.current;
    const [rosterRows, attendanceRows, event] = await Promise.all([
      fetchRoster(clubId),
      fetchEventAttendance(eventId),
      fetchEvent(eventId),
    ]);

    // A newer load() has started since this one did (see loadSeqRef above)
    // -- discard this response outright rather than let it apply out of
    // order over data a later call already wrote.
    if (seq !== loadSeqRef.current) return;

    // Fails closed to "not an organizer" on a roster fetch failure, the
    // same rule index.tsx:113 already follows -- the worst case is a host
    // who temporarily loses this screen, not one who is shown attendance
    // they should not see.
    const myRole = (rosterRows ?? []).find(
      (m) => m.profile_id === session?.user.id,
    );
    setIsOrganizer(myRole ? canInvite(myRole.role) : false);
    setRoster(rosterRows ?? []);

    setAttendanceFailed(attendanceRows === null);
    // On failure, leave `rows` exactly as it is rather than blanking it to
    // `[]` -- unlike the club/event screens' section-level failures, EVERY
    // piece of this screen (the summary line, every group) is driven by
    // this one array, so replacing it with an empty one on a transient
    // refetch failure would wipe a door list the host is actively working
    // down, not just show a stale message. `attendanceFailed` above is what
    // tells the render which is which.
    if (attendanceRows !== null) {
      setRows((current) =>
        mergeAttendance(attendanceRows, current, busyRef.current),
      );
    }

    setEventFailed(event === null);
    // The organizer tail: starts_at - 1h to ends_at + 24h
    // (attendance_window_open, 20260827030000). Only an organizer ever
    // reaches this screen, so the tail is unconditional here -- there is no
    // member-window branch to choose between.
    setOpensAt(event ? addHours(event.starts_at, -1) : null);
    setClosesAt(event ? addHours(event.ends_at, 24) : null);

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

  // Checked before `!ready`, same guard-ordering fix already applied on
  // index.tsx: `ready` only ever becomes true inside the effect above,
  // which returns immediately with no session, so a signed-out visitor
  // could otherwise spin forever instead of being redirected.
  if (!session) return <Redirect href="/sign-in" />;

  if (!ready) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!isOrganizer) {
    return (
      <Screen contentStyle={styles.container}>
        <ErrorBanner message="You are not an organizer of this club." />
      </Screen>
    );
  }

  const windowOpen = checkInOpen(opensAt, closesAt);
  const summary = attendanceSummary(rows);
  const grouped = groupRows(rows);
  // Anyone already on the door list -- a confirmed booking or an existing
  // check-in row -- is excluded from the walk-in picker. `record_attendance`
  // would not refuse a double-add (`on conflict (event_id, profile_id) do
  // update` -- 20260827030000 -- makes it a deliberate idempotent upsert),
  // so this is UX, not error-avoidance: offering to add someone who is
  // already on the list is just confusing at the door.
  const alreadyListed = new Set(rows.map((r) => r.profile_id));
  const walkInCandidates = roster.filter((m) => !alreadyListed.has(m.profile_id));

  /**
   * Optimistic write with rollback -- the one screen in the app where
   * latency is felt as a physical queue of people at a door. Applies
   * locally, fires the RPC, and on refusal rolls back to the previous
   * value and shows why. The server is authoritative: a refusal refetches
   * rather than trusting local state, since the reason it failed (the
   * window just closed, check-in got disabled mid-game) is exactly the
   * kind of thing that makes the rest of local state suspect too.
   */
  async function setState(person: AttendanceRow, next: AttendanceState | null) {
    const previous = person.state;
    setRows((current) =>
      current.map((r) =>
        r.profile_id === person.profile_id ? { ...r, state: next } : r,
      ),
    );
    setBusyFlag(person.profile_id, true);

    const { error: writeError } =
      next === null
        ? await clearAttendance({ eventId, profileId: person.profile_id })
        : await recordAttendance({
            eventId,
            profileId: person.profile_id,
            state: next,
          });

    setBusyFlag(person.profile_id, false);

    if (writeError) {
      setRows((current) =>
        current.map((r) =>
          r.profile_id === person.profile_id ? { ...r, state: previous } : r,
        ),
      );
      setError(writeError);
      void load();
    }
  }

  /**
   * Adding a walk-in IS marking them arrived -- they are, definitionally,
   * standing at the door. Optimistically inserts a new row (booking_status
   * null, so groupRows above always places it under "Walk-ins") and rolls
   * back to no row at all on refusal, the same shape setState uses for an
   * existing row.
   */
  async function addWalkIn(member: ClubMember) {
    setPickerOpen(false);
    const newRow: AttendanceRow = {
      profile_id: member.profile_id,
      display_name: member.display_name,
      skill_level: member.skill_level,
      event_table_id: null,
      table_label: null,
      table_position: null,
      booking_status: null,
      state: 'arrived',
      recorded_by: null,
      recorded_at: null,
    };
    setRows((current) => [...current, newRow]);
    setBusyFlag(member.profile_id, true);

    const { error: writeError } = await recordAttendance({
      eventId,
      profileId: member.profile_id,
      state: 'arrived',
    });

    setBusyFlag(member.profile_id, false);

    if (writeError) {
      setRows((current) =>
        current.filter((r) => r.profile_id !== member.profile_id),
      );
      setError(writeError);
      void load();
    }
  }

  function renderPerson(r: AttendanceRow) {
    return (
      <View key={r.profile_id} style={styles.personRow}>
        <Text style={styles.name}>{r.display_name}</Text>
        <CheckInControl
          label={r.display_name}
          state={r.state}
          busy={!!busy[r.profile_id]}
          disabled={!windowOpen}
          onChange={(next) => void setState(r, next)}
        />
      </View>
    );
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Text style={styles.heading}>Check-in</Text>

      {error ? <ErrorBanner message={error} /> : null}

      {attendanceFailed && rows.length === 0 ? (
        // `fetchEventAttendance` returns null on failure the same way it
        // returns `[]` on a genuinely empty list -- without this branch a
        // dropped network read rendered as "0 of 0 here" plus empty tables,
        // telling a host nobody is booked when the truth is the read never
        // happened. `rows.length === 0` (rather than `attendanceFailed`
        // alone) is what keeps a stale-but-real list on screen, with its own
        // note below, if a LATER refetch fails after a good load already
        // populated it -- losing an in-progress door list to one transient
        // refetch failure would be worse than the bug this fixes.
        <Text style={styles.help}>
          Could not load who is booked for this game.
        </Text>
      ) : (
        <>
          <Text style={styles.summary}>
            {/* Denominator is every known row, walk-ins included -- not
                `summary.booked`. `summary.here` already counts a walk-in's
                arrival (a walk-in is, definitionally, standing at the door),
                so a denominator that excluded walk-ins could show a numerator
                bigger than its own total ("3 of 2 here") the moment a
                walk-in showed up. Counting everyone the numerator can count
                is what keeps the fraction meaningful. */}
            {summary.here} of {rows.length} here
          </Text>
          <Text style={styles.help}>{summary.notComing} not coming</Text>
          <Text style={styles.help}>{summary.unaccounted} unaccounted</Text>
          {attendanceFailed ? (
            <Text style={styles.help}>
              Could not refresh the list. Showing the last known state.
            </Text>
          ) : null}
        </>
      )}

      {!windowOpen ? (
        <Text style={styles.help}>
          {eventFailed
            ? // `fetchEvent` returning null means either the read failed or
              // the event does not exist -- either way, "closed" is not
              // known to be true, only that the window could not be
              // confirmed. Saying "closed" here was a false statement about
              // the EVENT when the actual problem was the fetch.
              'Could not confirm whether check-in is open for this game. You can still see who was recorded.'
            : 'Check-in is closed for this game. You can still see who was recorded.'}
        </Text>
      ) : null}

      {grouped.tables.map((g) => (
        <View key={g.id} testID={`door-table-${g.id}`} style={styles.group}>
          <Text style={styles.groupHeading}>{g.label}</Text>
          <Card style={styles.card}>{g.rows.map(renderPerson)}</Card>
        </View>
      ))}

      {grouped.anyTable.length > 0 ? (
        <View testID="door-any-table" style={styles.group}>
          <Text style={styles.groupHeading}>Any table</Text>
          <Card style={styles.card}>{grouped.anyTable.map(renderPerson)}</Card>
        </View>
      ) : null}

      {grouped.walkIns.length > 0 ? (
        <View testID="door-walkins" style={styles.group}>
          <Text style={styles.groupHeading}>Walk-ins</Text>
          <Card style={styles.card}>{grouped.walkIns.map(renderPerson)}</Card>
        </View>
      ) : null}

      <Button
        variant="secondary"
        disabled={!windowOpen}
        onPress={() => setPickerOpen(true)}
        accessibilityLabel="Add a walk-in"
      >
        Add a walk-in
      </Button>

      {pickerOpen ? (
        <View testID="walkin-picker">
          <Card style={styles.card}>
            {walkInCandidates.length === 0 ? (
              <Text style={styles.help}>
                Everyone on the roster is already on this list.
              </Text>
            ) : (
              walkInCandidates.map((m) => (
                <Pressable
                  key={m.profile_id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${m.display_name}`}
                  onPress={() => void addWalkIn(m)}
                  style={styles.candidateRow}
                >
                  <Text style={styles.name}>{m.display_name}</Text>
                </Pressable>
              ))
            )}
            <Button
              variant="ghost"
              onPress={() => setPickerOpen(false)}
              accessibilityLabel="Never mind"
            >
              Never mind
            </Button>
          </Card>
        </View>
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
  summary: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  group: { gap: space[2] },
  groupHeading: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.text,
  },
  card: { padding: space[4], gap: space[3] },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  name: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    color: colors.text,
    flexShrink: 1,
  },
  candidateRow: {
    paddingVertical: space[2],
  },
});
