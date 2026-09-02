import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../../components/Button';
import Card from '../../../../../components/Card';
import CheckInControl from '../../../../../components/CheckInControl';
import ErrorBanner from '../../../../../components/ErrorBanner';
import Screen from '../../../../../components/Screen';
import TabBar from '../../../../../components/TabBar';
import { ChevronLeftIcon } from '../../../../../components/icons';
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
 * `contested` answers a different question than "is this profile busy right
 * now" -- it answers "was a write for this profile in flight at ANY POINT
 * since this read was issued" (see `load()`, which builds this map from
 * `writeSeqAtLoadEntry` and `busyAtLoadEntry`). The two are not the same
 * question: a write that starts AFTER the read begins and both starts and
 * finishes before the read's responses arrive clears `busy` well before this
 * merge ever runs, so "busy right now" sees nothing outstanding and lets the
 * read's stale snapshot win -- the exact clobber this function exists to
 * prevent, just arriving from the other direction. `load()`'s doc comment
 * carries the concrete before/after timeline.
 *
 * A profile marked `contested` has its LOCAL `state` win over the server's.
 * A row that is contested but entirely absent from the server response (an
 * optimistic walk-in insert whose write has not been reflected yet) is kept
 * outright rather than dropped.
 *
 * Only `state` is contested while a write is in flight -- everything else
 * about the row (table assignment, display name, ...) is free to move
 * elsewhere and the server's read of it is authoritative. Preserving the
 * whole local row here would silently undo a co-organizer's table move that
 * happened to land in the same window as this profile's in-flight
 * check-in write.
 */
function mergeAttendance(
  serverRows: AttendanceRow[],
  currentRows: AttendanceRow[],
  contested: Record<string, boolean>,
): AttendanceRow[] {
  const currentById = new Map(currentRows.map((r) => [r.profile_id, r]));
  const merged = serverRows.map((r) => {
    if (!contested[r.profile_id]) return r;
    const local = currentById.get(r.profile_id);
    return local ? { ...r, state: local.state } : r;
  });
  const serverIds = new Set(serverRows.map((r) => r.profile_id));
  for (const r of currentRows) {
    if (contested[r.profile_id] && !serverIds.has(r.profile_id)) {
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
  const router = useRouter();
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
  // Null until the first successful event read -- see the render below,
  // which needs to tell "never asked for check-in" apart from "window
  // closed" to say something true about why the screen is inert.
  const [checkInRequired, setCheckInRequired] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-profile, not screen-wide: one slow write must not freeze the other
  // fifteen rows a host is tapping down at the door. A COUNT, not a
  // boolean: a mis-tap corrected before the first write's round trip lands
  // (routine at a door) puts a SECOND write in flight for the same profile
  // before the first resolves. A boolean cleared unconditionally by
  // whichever write finishes first would drop the guard while the other
  // write was still outstanding -- see `setState` below.
  const [busy, setBusy] = useState<Record<string, number>>({});
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
  // ref is not). `load()` reads this at its own ENTRY, before the network
  // round trip even starts (see `busyAtLoadEntry` below), to answer "was a
  // write for this profile already in flight when this read was issued" --
  // one half of the "in flight at any point since" question `load()`'s
  // merge has to answer. incrBusy/decrBusy always replace this object
  // wholesale rather than mutating it in place, which is what makes holding
  // onto a reference captured at load() entry a safe, frozen snapshot even
  // though busy-ness for other profiles keeps changing underneath it.
  const busyRef = useRef<Record<string, number>>({});

  function incrBusy(profileId: string) {
    busyRef.current = {
      ...busyRef.current,
      [profileId]: (busyRef.current[profileId] ?? 0) + 1,
    };
    setBusy(busyRef.current);
  }

  function decrBusy(profileId: string) {
    const next = Math.max(0, (busyRef.current[profileId] ?? 0) - 1);
    busyRef.current = { ...busyRef.current, [profileId]: next };
    setBusy(busyRef.current);
  }

  // The sequence number of the most recently STARTED write for each
  // profile. Mirrors `loadSeqRef` above, one profile at a time, and serves
  // two purposes:
  //
  // 1. A failed write's rollback must only apply if it is still that
  //    profile's LATEST write. Without this, a double-tap that corrects a
  //    mis-tap (write #1 Here, write #2 Not coming, both in flight) would
  //    let write #1's rollback -- built from a `previous` closure captured
  //    before write #2 even started -- overwrite write #2's optimistic
  //    value with a state neither the server nor the host chose, the
  //    moment write #1 happens to be the one that fails.
  // 2. `load()` snapshots this map at its own ENTRY (`writeSeqAtLoadEntry`
  //    below) and compares it against this ref's LIVE value once its
  //    responses arrive: any profile whose sequence has moved on in
  //    between had a write START after this read was issued, so this read
  //    cannot possibly reflect that write's outcome -- regardless of
  //    whether the write has since resolved and cleared `busy`. This is
  //    mutated IN PLACE (`writeSeqRef.current[id] = seq`, not a wholesale
  //    replace like `busyRef`), so `load()` must take a shallow copy, not
  //    hold a bare reference, when it snapshots this at entry.
  const writeSeqRef = useRef<Record<string, number>>({});

  // Bumps and returns profileId's write sequence. Shared by `setState` and
  // `addWalkIn` -- both start a write the merge in `load()` needs to be
  // able to see, and both also need the returned number back, to guard
  // their own rollback (see writeSeqRef's comment).
  function nextWriteSeq(profileId: string) {
    const seq = (writeSeqRef.current[profileId] ?? 0) + 1;
    writeSeqRef.current[profileId] = seq;
    return seq;
  }

  async function load() {
    const seq = ++loadSeqRef.current;
    // Snapshotted BEFORE the network round trip starts -- see the doc
    // comments on `busyRef`/`writeSeqRef` above and on `mergeAttendance`
    // for why "in flight right now" is the wrong question for the merge
    // below to ask, and why these two together answer the right one ("in
    // flight at ANY POINT since this read was issued").
    const writeSeqAtLoadEntry = { ...writeSeqRef.current };
    const busyAtLoadEntry = busyRef.current;
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
      // Computed HERE, synchronously, right as the response arrives --
      // not read from inside the `setRows` updater below. React's
      // automatic batching does not necessarily invoke that updater the
      // instant `setRows` is called; it can run later, once React gets
      // around to flushing, and a write can resolve in that gap. A profile
      // is CONTESTED (its local `state` wins the merge) if EITHER it was
      // already busy when this read was issued (`busyAtLoadEntry`) OR its
      // write sequence has moved past what it was at that same moment
      // (`writeSeqAtLoadEntry` vs. `writeSeqRef.current`, read live, right
      // now) -- see the doc comments on `writeSeqRef` and on
      // `mergeAttendance` for why the second half is required: a write
      // that starts after this read begins and both starts and finishes
      // before this read's responses arrive clears `busy` before this
      // point ever runs, so the first half alone would miss it and let
      // this merge apply the stale server row after all -- the original
      // clobber, arriving from the other direction.
      const contested: Record<string, boolean> = {};
      for (const profileId of new Set([
        ...Object.keys(writeSeqAtLoadEntry),
        ...Object.keys(busyAtLoadEntry),
        ...Object.keys(writeSeqRef.current),
      ])) {
        contested[profileId] =
          !!busyAtLoadEntry[profileId] ||
          writeSeqRef.current[profileId] !== writeSeqAtLoadEntry[profileId];
      }
      setRows((current) =>
        mergeAttendance(attendanceRows, current, contested),
      );
    }

    setEventFailed(event === null);
    // The organizer tail: starts_at - 1h to ends_at + 24h
    // (attendance_window_open, 20260827030000). Only an organizer ever
    // reaches this screen, so the tail is unconditional here -- there is no
    // member-window branch to choose between.
    //
    // Mirrors my_upcoming_bookings' own `case when e.check_in_required then
    // ... end` (20260827070000_my_upcoming_bookings_check_in.sql:79-81):
    // when the event never asked for check-in, the window is null, exactly
    // as if this were an event with no dates at all. Without this check,
    // this screen derived a window from starts_at/ends_at alone --
    // `check_in_required = false` inside the time window still rendered a
    // fully "live"-looking door list (every control and "Add a walk-in"
    // enabled), and every tap raised "This game does not use check-in.".
    // The database has always refused these writes; this is what makes the
    // screen say so up front instead of after every tap.
    //
    // Only written on a SUCCESSFUL event read. A failed refetch (any
    // refused write anywhere on this screen calls `load()`, see
    // `setState`/`addWalkIn`) used to overwrite a previously-known window
    // with `null`, which reads as closed and disables every control --
    // silently locking the door for a host who was checking people in
    // seconds earlier, over one flaky read. Same reasoning the merge above
    // applies to `rows`, applied here to the window: a transient failure
    // keeps the last known good value rather than blanking it.
    if (event) {
      setCheckInRequired(event.check_in_required);
      if (event.check_in_required) {
        setOpensAt(addHours(event.starts_at, -1));
        setClosesAt(addHours(event.ends_at, 24));
      } else {
        setOpensAt(null);
        setClosesAt(null);
      }
    }

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

  // Every state below carries the tab bar, the same rule
  // app/clubs/[id]/index.tsx and app/clubs/[id]/venues.tsx already follow:
  // TabBar navigates with router.replace off an entry route that is itself
  // a <Redirect>, so the history stack is typically one deep, and a state
  // with no bar strands an organizer with no way out but relaunching the
  // app. The <Redirect> branch below is the deliberate exception -- it
  // renders nothing, and a signed-out visitor belongs at sign-in, not in a
  // tab bar.
  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
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
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!isOrganizer) {
    return (
      <Screen contentStyle={styles.container} tabBar={<TabBar active="club" />}>
        <ErrorBanner message="You are not an organizer of this club." />
      </Screen>
    );
  }

  const windowOpen = checkInOpen(opensAt, closesAt);
  const summary = attendanceSummary(rows);
  // Booked players who have arrived, out of every booked player.
  // `attendanceSummary` has no combined arrival count to reuse here --
  // it deliberately never counted walk-ins and booked players together
  // (see its own doc comment) -- so this filters `rows` directly instead.
  const bookedHere = rows.filter(
    (r) => r.booking_status !== null && r.state === 'arrived',
  ).length;
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
    const profileId = person.profile_id;
    const previous = person.state;
    // This write's own sequence number for this profile -- see
    // `writeSeqRef` above.
    const seq = nextWriteSeq(profileId);

    setRows((current) =>
      current.map((r) => (r.profile_id === profileId ? { ...r, state: next } : r)),
    );
    incrBusy(profileId);

    const { error: writeError } =
      next === null
        ? await clearAttendance({ eventId, profileId })
        : await recordAttendance({ eventId, profileId, state: next });

    decrBusy(profileId);

    if (writeError) {
      // A newer write for this profile started since this one did -- its
      // optimistic value is what belongs on screen now, not this call's
      // stale `previous`. Rolling back here would overwrite a value
      // neither the server (which has not seen the newer write either) nor
      // the host (who already moved on) chose.
      if (writeSeqRef.current[profileId] === seq) {
        setRows((current) =>
          current.map((r) =>
            r.profile_id === profileId ? { ...r, state: previous } : r,
          ),
        );
      }
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
    incrBusy(member.profile_id);
    // Bumps the same sequence `setState` does -- `load()`'s merge (see its
    // doc comment) needs this to tell a walk-in write that started after a
    // refetch began apart from one that started before it, the same way it
    // needs it for an existing row's `state`. Without this, a walk-in whose
    // write starts after `load()` begins and resolves before `load()`'s
    // responses arrive would read as "not busy" by the time the merge runs
    // AND be absent from the server snapshot that merge is folding in --
    // vanishing from the door list outright, not just reverting a state.
    // The returned number is also this rollback's own guard below, the
    // same shape `setState` uses for its `seq`.
    const seq = nextWriteSeq(member.profile_id);

    const { error: writeError } = await recordAttendance({
      eventId,
      profileId: member.profile_id,
      state: 'arrived',
    });

    decrBusy(member.profile_id);

    if (writeError) {
      // Same guard `setState`'s rollback uses: a newer write for this
      // profile (e.g. the host mis-tapped Add, then corrected it with
      // another write before this one's response arrived) has started
      // since this call did, and its optimistic value is what belongs on
      // screen now -- not this call's unconditional removal, which would
      // delete a row the host's later action put there on purpose. Without
      // this guard the asymmetry was cosmetic today (the `load()` this
      // branch already triggers repairs it moments later) but unintended.
      if (writeSeqRef.current[member.profile_id] === seq) {
        setRows((current) =>
          current.filter((r) => r.profile_id !== member.profile_id),
        );
      }
      setError(writeError);
      void load();
    }
  }

  // `display_name` carries no non-empty constraint (lib/clubs.ts /
  // event_attendance) and defaults to `''` -- an unnamed member used to
  // render a blank row wherever this screen shows one directly, announcing
  // nothing about who the row is for. Originally inlined in `renderPerson`
  // alone; extracted once the walk-in picker below needed the identical
  // guard a second time in this file, so the fallback has exactly one
  // spelling instead of growing a second one. (CheckInControl guards this
  // too, but with its own generic fallback for its own generic `label`
  // prop -- see its own comment -- so it is left as is.)
  function safeDisplayName(name: string): string {
    return name.trim() ? name : 'Unnamed member';
  }

  function renderPerson(r: AttendanceRow) {
    const displayName = safeDisplayName(r.display_name);
    return (
      <View key={r.profile_id} style={styles.personRow}>
        <Text style={styles.name}>{displayName}</Text>
        <CheckInControl
          label={displayName}
          state={r.state}
          busy={!!busy[r.profile_id]}
          disabled={!windowOpen}
          onChange={(next) => void setState(r, next)}
        />
      </View>
    );
  }

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      <Button
        variant="ghost"
        big={false}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        onPress={() => router.push(`/clubs/${clubId}/events/${eventId}`)}
        accessibilityLabel="Back to the game"
        style={styles.backButton}
      >
        Game
      </Button>

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
          {/* Grouped in one tightly-spaced block (rather than left at the
              screen's normal space[4] rhythm) so the two secondary counts
              read as part of THIS summary rather than as leftover help
              text floating underneath it -- see the two Text styles below
              for why their color changed too. */}
          <View style={styles.summaryGroup}>
            <Text style={styles.summary}>
              {/* Denominator is `summary.booked`, not `rows.length`. A
                  denominator of every known row grows every time a walk-in
                  shows up, so "12 of 16 here" never converged on a number the
                  host actually set out to reach -- and its remainder was
                  notComing+unaccounted, not "still to come". `summary.booked`
                  only changes when a booking is made or cancelled, so it stays
                  a stable target through the night. Walk-ins are real
                  arrivals too, so they are still shown -- just as their own
                  count, not folded into a fraction whose denominator they'd
                  keep moving. */}
              {bookedHere} of {summary.booked} booked here ·{' '}
              {summary.walkIns} walk-in{summary.walkIns === 1 ? '' : 's'}
            </Text>
            {/* `summaryDetail`, not `help`: these two counts are what a
                host standing at a badly-lit door acts on -- collapse a
                table, go find a substitute -- so they need to actually be
                legible, not just present. `colors.textMuted` on
                `colors.bg` measures ~3.6:1, under the 4.5:1 AA floor for
                body text; `colors.textLabel` measures ~5.6:1 and is what
                the rest of this screen's genuine help/status text (below)
                keeps using `colors.textMuted` for -- that text is
                dispensable in a way these two counts are not. */}
            <Text style={styles.summaryDetail}>
              {summary.notComing} not coming
            </Text>
            <Text style={styles.summaryDetail}>
              {summary.unaccounted} unaccounted
            </Text>
          </View>
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
            : checkInRequired === false
              ? // Distinct from "closed": this game never asked for
                // check-in at all, so there is no window that could open.
                // Without this branch the screen said "closed" about a
                // game that was never live in the first place, which is a
                // different, false claim.
                'This game does not use check-in.'
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
              walkInCandidates.map((m) => {
                const name = safeDisplayName(m.display_name);
                return (
                  <Pressable
                    key={m.profile_id}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${name}`}
                    onPress={() => void addWalkIn(m)}
                    style={styles.candidateRow}
                  >
                    <Text style={styles.name}>{name}</Text>
                  </Pressable>
                );
              })
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
  backButton: { alignSelf: 'flex-start' },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  summaryGroup: { gap: space[1] },
  summary: {
    fontFamily: type.bodyBold,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
  // The two decision-driving counts under the summary line. Same size as
  // `help` (16pt is this app's one sanctioned exception below the 18pt
  // body minimum), but `colors.textLabel` in place of `colors.textMuted`
  // -- see the comment where this style is used for the contrast numbers.
  summaryDetail: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textLabel,
    lineHeight: 22,
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
