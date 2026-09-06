import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Button from '../../../../../components/Button';
import Card from '../../../../../components/Card';
import CheckInControl from '../../../../../components/CheckInControl';
import ErrorBanner from '../../../../../components/ErrorBanner';
import PaidControl from '../../../../../components/PaidControl';
import Screen from '../../../../../components/Screen';
import TabBar from '../../../../../components/TabBar';
import Tag from '../../../../../components/Tag';
import TextField from '../../../../../components/TextField';
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
import { fetchEvent, formatFeeCents, type SeatingMode } from '../../../../../lib/events';
import { fetchEventPayments, setPaymentStatus } from '../../../../../lib/payments';
import { useSession } from '../../../../../lib/session';
import { addHours } from '../../../../../lib/time';
import { colors, layout, radius, space, type } from '../../../../../lib/theme';

/**
 * How long a row stays put after it is touched, before it re-buckets into
 * the section its state actually belongs to.
 *
 * Marking somebody here and marking them paid are ONE interaction at the
 * door — the organizer taps "Here", then taps "Paid" on the same row, with
 * the person still standing in front of them. A row that jumped to another
 * section the instant "Here" landed would move out from under the second
 * tap. So the write lands immediately (nothing here delays the RPC or the
 * optimistic update) and only the row's PLACEMENT waits, restarting on
 * every further tap.
 *
 * At module scope so the by-hand pass can tune this single number.
 */
const SETTLE_MS = 4000;

/**
 * Review Fix 4: how long the undo banner (see `undoFor` below) stays
 * offered before it expires on its own. Without a bound, `undoFor` was
 * cleared only by tapping it or by a further settle -- so in a lull between
 * arrivals, a banner from ten minutes ago still read as "the tap you just
 * made", and it is a one-tap `clearAttendance`. Long enough that a host
 * glancing away for a few seconds still finds it (this is not the 4s
 * settle window itself, which is about the row's PLACEMENT, not the
 * banner), short enough that it cannot plausibly be mistaken for a recent
 * tap once it fires.
 */
const UNDO_MS = 10_000;

type TableGroup = { id: string; label: string; rows: AttendanceRow[] };

/**
 * The four buckets an open-seating door list shows. `walkIns` is the same
 * bucket the table grouping already had; the other three replace "which
 * table" with "where does this person stand", which is the only question an
 * event with no tables can answer.
 */
type StatusSection = 'toArrive' | 'here' | 'notComing' | 'walkIns';

/**
 * A row's TRUE section, from its own data alone. A walk-in is checked
 * first, exactly as `groupRows` checks it first and for the same reason:
 * an organizer-added walk-in is definitionally already at the door, so it
 * belongs under "Walk-ins" whatever its attendance state says.
 */
function sectionOf(r: AttendanceRow): StatusSection {
  if (r.booking_status === null) return 'walkIns';
  if (r.state === 'arrived') return 'here';
  if (r.state === 'no_show') return 'notComing';
  return 'toArrive';
}

/**
 * The open-seating counterpart to `groupRows` below — NOT its replacement.
 * An assigned-tables event still groups by table (that is what its door list
 * has always shown, and it is the only way to find the person you are
 * looking at in a room of numbered tables); an open-seating event has no
 * tables to group by at all.
 *
 * `held` pins a recently-touched row to the section it was in when the
 * organizer first touched it — see SETTLE_MS above. It is a section, not a
 * boolean: once a row's state has changed, its pre-tap section cannot be
 * recovered from the row itself, and "hold it where it was" is precisely
 * what the settle window promises.
 *
 * Like `groupRows`, this preserves the server's own ordering within each
 * bucket rather than re-sorting.
 */
function groupByStatus(
  rows: AttendanceRow[],
  held: Record<string, StatusSection>,
): Record<StatusSection, AttendanceRow[]> {
  const groups: Record<StatusSection, AttendanceRow[]> = {
    toArrive: [],
    here: [],
    notComing: [],
    walkIns: [],
  };
  for (const r of rows) {
    groups[held[r.profile_id] ?? sectionOf(r)].push(r);
  }
  return groups;
}

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

  // ---- Task 8: open seating, search, and the payment marker -------------
  //
  // Defaults to 'assigned_tables' and is only ever written from a
  // SUCCESSFUL event read, the same rule the check-in window below follows:
  // a transient refetch failure must not silently reshape a door list the
  // host is working down.
  const [seatingMode, setSeatingMode] = useState<SeatingMode>('assigned_tables');
  const [feeCents, setFeeCents] = useState(0);
  // profile_id -> how many LIVE bookings share that person's booking group.
  // Only > 1 is interesting (a solo booking is a group of one), and the
  // badge is what tells an organizer placing people on the day who arrived
  // together.
  const [groupSizes, setGroupSizes] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  // profile_id -> true iff marked paid. Deliberately its own map rather
  // than a field folded into `rows`: `mergeAttendance` is tuned for the
  // exact question "whose `state` is contested", and widening it to carry a
  // second, separately-fetched fact is how that hard-won merge would start
  // to drift. The merge's `contested` map is reused for payments verbatim
  // in `load()` below, so an in-flight payment write survives a refetch the
  // same way an in-flight attendance write does.
  const [paid, setPaidMap] = useState<Record<string, boolean>>({});
  // `fetchEventPayments` returns null on failure and [] on "nobody has
  // paid" -- the same distinction `attendanceFailed` draws, and the same
  // reason: rendering a failed read as "nobody has paid" is a false
  // statement about people's money.
  const [paymentsFailed, setPaymentsFailed] = useState(false);
  // The rows being held in place by the settle window (see SETTLE_MS), and
  // their pending timers. The timers live in a ref, not state: they are not
  // rendered, and re-rendering on every timer swap would be pointless work
  // at the exact moment a host is tapping fastest.
  const [held, setHeld] = useState<Record<string, StatusSection>>({});
  const settlingRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // The one row that has just moved, offered back. Only ever one: at a door
  // the undo that matters is the tap you regret THIS second.
  const [undoFor, setUndoFor] = useState<{
    profileId: string;
    name: string;
    state: AttendanceState;
  } | null>(null);
  // Review Fix 4: the pending expiry for whatever `undoFor` is currently
  // offered -- see UNDO_MS above and `offerUndo` below. A ref, not state,
  // for the same reason `settlingRef` is: it is not itself rendered.
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `rows` for the settle timer's callback, which fires up to four
  // seconds after the render that scheduled it and must report where the
  // row actually LANDED (a host can tap Here, then Not coming, inside one
  // window) rather than the stale row captured in that render's closure.
  const rowsRef = useRef<AttendanceRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // The attendance `state` a row carried the moment its settle window
  // OPENED (the first tap, attendance or payment, of this window) -- see
  // `holdRow` below. Undo exists to reverse an attendance move made THIS
  // gesture; a payment-only tap on someone already `arrived` opens a window
  // too (so the paid chip's own tap gets the settle behaviour), but must not
  // raise an undo that clears an attendance state it never touched. Kept in
  // a ref, not `held`, because it needs to survive past the moment `held`'s
  // entry for this profile is deleted (the settle timer fires) -- the
  // comparison against the row's settled `state` happens in that same
  // callback.
  const preTapStateRef = useRef<Record<string, AttendanceState | null>>({});

  // Every pending settle timer is cleared on unmount: a host who backs out
  // of this screen mid-window must not have a timer wake up afterwards and
  // set state on a screen that is gone.
  useEffect(() => {
    const timers = settlingRef.current;
    return () => {
      for (const timer of Object.values(timers)) clearTimeout(timer);
      settlingRef.current = {};
    };
  }, []);

  // Review Fix 4's own timer gets its own cleanup effect, deliberately
  // separate from the one above rather than folded into it: the settle
  // timers' cleanup is preserved exactly as it already was, and this is new
  // behaviour alongside it, not a restructuring of it.
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

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

  // The payment writes' own rollback sequence, alongside (never instead of)
  // `writeSeqRef`. Every payment write still bumps `writeSeqRef` -- `load()`'s
  // merge asks "was ANY write for this profile in flight", and a payment write
  // is one -- but its ROLLBACK has to ask a narrower question: "is this still
  // the latest write of THE SAME FACT". Guarding a failed payment write on
  // the shared counter instead would suppress its rollback whenever an
  // ATTENDANCE write for that person had started in the meantime, leaving
  // somebody marked paid on a write the server refused, with nothing left to
  // correct it (the refetch that failure fires treats the profile as
  // contested, so the stale local `true` would win that merge too). Attendance
  // and payment are two different facts about one person; only same-fact
  // writes can be said to supersede each other.
  const paidSeqRef = useRef<Record<string, number>>({});

  function nextPaidSeq(profileId: string) {
    const seq = (paidSeqRef.current[profileId] ?? 0) + 1;
    paidSeqRef.current[profileId] = seq;
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

    /**
     * The "whose local value wins this merge" map, against the two entry
     * snapshots above and `writeSeqRef` read LIVE at the moment of the call.
     *
     * A function rather than one inline computation only because this
     * function now has two responses to fold in, arriving from two separate
     * awaits (attendance, then payments) -- and each must ask this question
     * at ITS OWN arrival, never once up front for both. Calling it twice is
     * the whole point; the rule it encodes is unchanged, and the comment at
     * each call site says which response it is answering for.
     */
    function contestedNow(): Record<string, boolean> {
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
      return contested;
    }

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
    const organizer = myRole ? canInvite(myRole.role) : false;
    setIsOrganizer(organizer);
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
      const contested = contestedNow();
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
      // Same "only on a successful read" rule as the window below, for the
      // same reason: a flaky refetch must not reshape the list (status
      // sections back to table groups) or blank out what people owe, under
      // a host who is mid-queue. `?? 'assigned_tables'` mirrors the
      // column's own `not null default`, so an event read by an older
      // client contract still lands on the behaviour this screen has always
      // had.
      setSeatingMode(event.seating_mode ?? 'assigned_tables');
      setFeeCents(event.fee_cents ?? 0);
      // Live bookings only: a cancelled or declined seat is not somebody
      // who arrived with anyone. `bookings` is already embedded in the
      // event read (EVENT_COLUMNS), so the badge costs no extra round trip.
      const sizes: Record<string, number> = {};
      const live = (event.bookings ?? []).filter(
        (b) => b.status === 'confirmed' || b.status === 'waitlisted',
      );
      const perGroup: Record<string, number> = {};
      for (const b of live) {
        perGroup[b.group_id] = (perGroup[b.group_id] ?? 0) + 1;
      }
      for (const b of live) sizes[b.profile_id] = perGroup[b.group_id];
      setGroupSizes(sizes);

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

    // Payments come LAST, on their own round trip, and nothing above waits
    // on them: the door list -- the thing a host is standing there needing
    // -- paints as soon as attendance lands, exactly as it did before this
    // read existed, and who has paid fills in a beat later.
    //
    // Only for an organizer, and that is the point of doing it here rather
    // than in the Promise.all above: `event_payment_status` is
    // organizer-only (20260906150000) and the answer to "am I an organizer"
    // is the roster read that just landed. Asking alongside it would have a
    // plain member's client issue a question it has no business asking --
    // the RLS gate would refuse it, but the request itself is the leak of
    // intent. `organizer` (the freshly-read answer), not the `isOrganizer`
    // state set above, because state updates are async.
    //
    // Fix 2 (reverted by the final review, finding #4): this used to also
    // gate on the event carrying a fee, on the theory that a fee-free event
    // draws no payment UI to feed. The spec says payment tracking applies
    // to EVERY event, not only ones that charge, and the fee gate created
    // unreachable rows: mark people paid on a $15 game, then drop the fee to
    // $0, and `event_payments` rows persist with no UI able to see or clear
    // them ever again -- `set_payment_status(..., false)` becomes
    // unreachable. Only organizer status gates this fetch now. The extra
    // round trip on a fee-free event's every load is an accepted cost, not
    // a bug.
    if (!organizer) return;
    const payments = await fetchEventPayments(eventId);

    // Re-checked after this second round trip for the same reason it is
    // checked after the first: a newer load() may have started in between,
    // and only the most-recently-started call may write its result back.
    if (seq !== loadSeqRef.current) return;

    // `null` is a FAILED read, not "nobody has paid" -- the same
    // distinction `attendanceFailed` draws above, and the same reason:
    // rendering a dropped read as "nobody has paid" is a false statement
    // about people's money. On failure the map is left exactly as it is.
    setPaymentsFailed(payments === null);
    if (payments !== null) {
      // Absence of a row IS the unpaid state (`set_payment_status` deletes
      // rather than storing a false), so the server's answer is rebuilt
      // from scratch -- except for a profile whose own write was in flight
      // at any point since this load began, whose local value wins for
      // exactly as long as that write is unresolved. Same rule as the
      // attendance merge above, asked afresh for THIS response.
      const contested = contestedNow();
      setPaidMap((current) => {
        const next: Record<string, boolean> = {};
        for (const p of payments) next[p.profile_id] = true;
        for (const profileId of Object.keys(current)) {
          if (contested[profileId]) next[profileId] = current[profileId];
        }
        return next;
      });
    }
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
  const openSeating = seatingMode === 'open_seating';
  // Case-insensitive substring on the name, over the SAME `rows` array the
  // groups are built from, so search narrows the list without disturbing
  // the server's ordering or any of the state above. Matched against
  // `safeDisplayName`, so an unnamed member is findable by the words the
  // screen actually shows for them. Only the open-seating path draws the
  // field, so an assigned-tables door list is untouched by it.
  const needle = query.trim().toLowerCase();
  const visibleRows = needle
    ? rows.filter((r) =>
        safeDisplayName(r.display_name).toLowerCase().includes(needle),
      )
    : rows;
  const statusGroups = groupByStatus(visibleRows, held);
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
   * The payment marker's write. Modelled line for line on `setState` above
   * -- optimistic update, `incrBusy`/`decrBusy`, a sequence-guarded
   * rollback, `setError` plus an authoritative refetch on refusal -- and
   * deliberately NOT a second, simpler write path: everything the comments
   * on `busy`, `writeSeqRef` and `mergeAttendance` say about two writes for
   * one profile racing at a door is just as true of a "here, and paid"
   * double tap as it is of "here, no wait, not coming".
   *
   * It shares `busy` and `writeSeqRef` with the attendance writes: those
   * are per-PROFILE guards ("is anything in flight for this person"), and a
   * payment write and an attendance write for the same person are exactly
   * the pair that must not interleave badly. Only the ROLLBACK guard is its
   * own (`paidSeqRef`), because that one asks a per-FACT question -- see
   * the comment on `paidSeqRef` above.
   */
  async function setPaid(person: AttendanceRow, next: boolean) {
    const profileId = person.profile_id;
    const previous = !!paid[profileId];
    // Both counters: the shared one so `load()`'s merge can see this write
    // at all, the payment-specific one to guard this call's own rollback.
    // See `paidSeqRef` above for why those are two different questions.
    nextWriteSeq(profileId);
    const seq = nextPaidSeq(profileId);

    setPaidMap((current) => ({ ...current, [profileId]: next }));
    incrBusy(profileId);

    const { error: writeError } = await setPaymentStatus({
      eventId,
      profileId,
      isPaid: next,
    });

    decrBusy(profileId);

    if (writeError) {
      // Same guard `setState`'s rollback uses, for the same reason: a newer
      // PAYMENT write for this profile has started since this one did, and
      // its optimistic value -- not this call's stale `previous` -- is what
      // belongs on screen.
      if (paidSeqRef.current[profileId] === seq) {
        setPaidMap((current) => ({ ...current, [profileId]: previous }));
      }
      setError(writeError);
      void load();
    }
  }

  /**
   * Review Fix 4: puts up the undo banner AND bounds its lifetime to
   * UNDO_MS, so a tap from a lull ago cannot still read as the tap the host
   * just made. Only ever one pending expiry at a time, matching `undoFor`
   * itself being "only ever one" -- a fresh offer replaces whichever expiry
   * was already ticking down for the row it is displacing.
   */
  function offerUndo(next: { profileId: string; name: string; state: AttendanceState }) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoFor(next);
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null;
      setUndoFor(null);
    }, UNDO_MS);
  }

  /**
   * Starts (or restarts) a row's settle window -- see SETTLE_MS.
   *
   * Called at the TAP, not inside the write functions: the window is about
   * where a row sits under the organizer's finger, not about the write, and
   * routing it through `setState`/`setPaid` would also hold a row still on
   * the one write that means the opposite (undo, below, which exists to
   * move the row back immediately).
   *
   * The section is captured on the FIRST tap of a window and kept for the
   * whole of it, so a second tap that changes the state again (here, then
   * not coming) still cannot move the row mid-gesture.
   *
   * `preTapStateRef` is captured the same way, on the same first tap, for
   * Fix 1's guard below: `PaidControl` is not window-gated (see its
   * docstring) and opens this same settle window, so a payment-only tap on
   * someone already `arrived` must not be mistaken, at settle time, for the
   * tap that put them there.
   */
  function holdRow(person: AttendanceRow) {
    // Only the status sections move rows around. An assigned-tables door
    // list groups by table, and a check-in never changes anybody's table --
    // there is nothing to hold still, so that path keeps behaving exactly
    // as it did before this window existed.
    if (!openSeating) return;
    const profileId = person.profile_id;
    const pending = settlingRef.current[profileId];
    if (pending) clearTimeout(pending);

    setHeld((current) =>
      profileId in current
        ? current
        : { ...current, [profileId]: sectionOf(person) },
    );
    if (!(profileId in preTapStateRef.current)) {
      preTapStateRef.current[profileId] = person.state;
    }

    settlingRef.current[profileId] = setTimeout(() => {
      delete settlingRef.current[profileId];
      setHeld((current) => {
        const next = { ...current };
        delete next[profileId];
        return next;
      });
      // Read from the ref, not from the `person` this closure captured: up
      // to four seconds have passed and the row may have been tapped again,
      // or refetched, since. A row that ended the window back at "not
      // determined" (the host corrected themselves) has moved nowhere and
      // needs no undo offered.
      const settled = rowsRef.current.find((r) => r.profile_id === profileId);
      // The state this profile's window OPENED with -- see `preTapStateRef`
      // above. Cleared here regardless of the outcome below: the window is
      // over either way, and the next tap starts a fresh one.
      const preTapState = preTapStateRef.current[profileId] ?? null;
      delete preTapStateRef.current[profileId];
      // Fix 1: undo is offered only when THIS window's activity actually
      // moved attendance -- comparing the settled state against what it was
      // when the window opened, not merely asking "is it non-null now".
      // Without this, a payment-only tap on someone already `arrived` (a
      // routine door pattern: work Here, then work the money) raised an
      // undo reading "marked here" that the host never did this gesture,
      // and whose one tap (`clearAttendance`) would destroy a correct
      // check-in without touching the payment it claimed to be about.
      if (
        settled &&
        settled.booking_status !== null &&
        settled.state !== null &&
        settled.state !== preTapState
      ) {
        offerUndo({
          profileId,
          name: safeDisplayName(settled.display_name),
          state: settled.state,
        });
      }
    }, SETTLE_MS);
  }

  /**
   * Undo, on the move a row just made. Calls the SAME `clearAttendance`
   * path (through `setState(person, null)`) the two-state control has
   * always used to get back to "not determined" -- no new RPC, and every
   * guarantee `setState` carries (optimistic update, busy count,
   * sequence-guarded rollback, refetch on refusal) applies unchanged.
   *
   * Deliberately does NOT open a settle window of its own: the point of
   * undo is that the row goes back where it was, now.
   */
  function undoMove(target: { profileId: string; name: string }) {
    const person = rows.find((r) => r.profile_id === target.profileId);
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoFor(null);
    if (!person) return;
    const pending = settlingRef.current[target.profileId];
    if (pending) clearTimeout(pending);
    delete settlingRef.current[target.profileId];
    setHeld((current) => {
      const next = { ...current };
      delete next[target.profileId];
      return next;
    });
    void setState(person, null);
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
    const groupSize = groupSizes[r.profile_id] ?? 1;
    const isPaid = !!paid[r.profile_id];
    return (
      <View key={r.profile_id} style={styles.personRow}>
        <View style={styles.person}>
          <Text style={styles.name}>{displayName}</Text>
          {groupSize > 1 || (feeCents > 0 && !isPaid) ? (
            <View style={styles.badges}>
              {/* Who arrived together. The spec keeps booking groups
                  visible on an open-seating night precisely because an
                  organizer placing people on the day has to seat a pair or
                  a foursome at the same table -- the group is the only
                  record of that, since nothing was pre-assigned. */}
              {groupSize > 1 ? <Tag variant="accent2">{`Group of ${groupSize}`}</Tag> : null}
              {/* What this person still owes, from the event's own
                  `fee_cents` through `formatFeeCents` -- the one place in
                  this app that turns integer cents into a dollar string.
                  No new price plumbing, and no float arithmetic anywhere
                  near money. */}
              {feeCents > 0 && !isPaid ? (
                <Text style={styles.owed}>{formatFeeCents(feeCents)} owed</Text>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.actions}>
          {/* Every organizer, every event -- finding #4 of the final review
              dropped the `feeCents > 0` gate this control used to carry.
              Payment tracking applies to every event, not only ones that
              charge a fee (the spec's own words), and gating the control on
              a fee made a $15 game's payment marks unreachable the moment
              the host dropped its fee to $0. Not gated on the check-in
              window either -- see PaidControl's docstring:
              `set_payment_status` has no window, deliberately. */}
          <PaidControl
            label={displayName}
            paid={isPaid}
            busy={!!busy[r.profile_id]}
            onChange={(next) => {
              holdRow(r);
              void setPaid(r, next);
            }}
          />
          <CheckInControl
            label={displayName}
            state={r.state}
            busy={!!busy[r.profile_id]}
            disabled={!windowOpen}
            onChange={(next) => {
              holdRow(r);
              void setState(r, next);
            }}
          />
        </View>
      </View>
    );
  }

  /**
   * One status section, with the count of what is actually under it -- so a
   * heading never claims a number the list below it does not show, which is
   * what a search would otherwise make it do.
   */
  function renderStatusSection(
    label: string,
    testID: string,
    group: AttendanceRow[],
    empty: string,
  ) {
    return (
      <View testID={testID} style={styles.group}>
        <Text style={styles.groupHeading}>
          {label} ({group.length})
        </Text>
        {group.length > 0 ? (
          <Card style={styles.card}>{group.map(renderPerson)}</Card>
        ) : (
          <Text style={styles.help}>{needle ? 'Nobody here matches.' : empty}</Text>
        )}
      </View>
    );
  }

  // Everything above the search field, and everything below the list --
  // identical in both seating modes, so each is built once and reused by
  // both `return`s below rather than kept as two copies that could drift.
  const before = (
    <>
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

      {paymentsFailed ? (
        // Distinct from "nobody has paid", which is what `?? []` would have
        // rendered this as -- and a false statement about people's money.
        // No longer gated on `feeCents > 0` (finding #4 of the final
        // review): `load()` now fetches payments for every organizer on
        // every event, and this screen now draws payment UI for one
        // regardless of fee, so this error line is reachable, and coherent,
        // whenever that read fails.
        <Text style={styles.help}>Could not load who has paid.</Text>
      ) : null}
    </>
  );

  const trailing = (
    <>
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
    </>
  );

  if (openSeating) {
    // An open-seating night has no tables to group by, so the list is
    // organised by where each person stands instead, with a search field to
    // find one name in a 60-70 person crowd. That field needs to STAY put
    // while the sections below it scroll -- once a host has scrolled down to
    // find someone, the search box being off-screen would mean scrolling
    // back up before looking up the next arrival, exactly the failure mode
    // that matters at a door with a queue. `Screen`'s `stickyHeaderIndices`
    // (see components/Screen.tsx) pins ScrollView's direct children by
    // index, so `before`/the search field/the rest are passed as three
    // separate top-level children here -- each carrying its own width and
    // padding styling below, since Screen does not wrap them for us in this
    // mode (see that prop's docstring for why).
    return (
      <Screen
        scroll
        stickyHeaderIndices={[1]}
        tabBar={<TabBar active="club" />}
      >
        <View style={[styles.scrollGroup, styles.scrollGroupTop]}>{before}</View>

        <View style={styles.stickySearch}>
          <TextField
            accessibilityLabel="Search by name"
            placeholder="Search by name"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        <View style={[styles.scrollGroup, styles.scrollGroupBottom]}>
          {undoFor ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Undo: ${undoFor.name}`}
              onPress={() => undoMove(undoFor)}
              style={styles.undoRow}
            >
              <Text style={styles.undoText}>
                {undoFor.name} marked{' '}
                {undoFor.state === 'arrived' ? 'here' : 'not coming'} · Undo
              </Text>
            </Pressable>
          ) : null}

          {renderStatusSection(
            'Still to arrive',
            'door-status-to-arrive',
            statusGroups.toArrive,
            'Everyone booked is accounted for.',
          )}
          {renderStatusSection(
            'Here',
            'door-status-here',
            statusGroups.here,
            'Nobody has arrived yet.',
          )}
          {renderStatusSection(
            'Not coming',
            'door-status-not-coming',
            statusGroups.notComing,
            'Nobody has been marked as not coming.',
          )}
          {/* Walk-ins keep the same "only when there are any" rule the
              table grouping gives them: an empty section here would be
              noise on the majority of nights. */}
          {statusGroups.walkIns.length > 0 ? (
            <View testID="door-walkins" style={styles.group}>
              <Text style={styles.groupHeading}>
                Walk-ins ({statusGroups.walkIns.length})
              </Text>
              <Card style={styles.card}>
                {statusGroups.walkIns.map(renderPerson)}
              </Card>
            </View>
          ) : null}

          {trailing}
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll contentStyle={styles.container} tabBar={<TabBar active="club" />}>
      {before}
      {/* The per-table grouping below is what an assigned-tables event's
          door list still shows -- untouched by search or the status
          sections above, which are open-seating only. No search field here,
          so this path never needs `stickyHeaderIndices`; it renders through
          `Screen`'s default (unwrapped-prop) behaviour exactly as before. */}
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

      {trailing}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  // Screen's `stickyHeaderIndices` mode passes `children` straight through
  // to the ScrollView unwrapped (see components/Screen.tsx), so each
  // top-level piece here has to carry the width/centering constraint
  // `styles.content` normally provides for us -- and the horizontal padding
  // `container` normally provides, split so it applies once per edge rather
  // than doubling up where two of these Views sit back to back.
  scrollGroup: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: space[6],
    gap: space[4],
  },
  scrollGroupTop: { paddingTop: space[6] },
  scrollGroupBottom: { paddingBottom: space[6], marginTop: space[4] },
  // The pinned search field. Opaque `colors.bg` (not transparent) is load-
  // bearing: once this sticks to the top of the ScrollView, the sections
  // scrolling underneath would otherwise show through its text. The
  // hairline bottom border (the same `colors.divider` token every other
  // hairline in this app uses) is what tells a host it is a fixed panel and
  // not just another row -- without a visible edge, a pinned bar with the
  // same background as the page can be hard to notice as "stuck" at all.
  stickySearch: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: space[6],
    paddingVertical: space[3],
    marginTop: space[4],
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
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
    // A paid chip alongside the two attendance chips is more than a phone
    // width can hold next to a long name; wrapping keeps every control at
    // full size rather than squeezing the touch targets this app sizes up
    // for its older players.
    flexWrap: 'wrap',
  },
  person: { gap: space[1], flexShrink: 1 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  // `colors.textLabel` (5.6:1 on bg), not `textMuted` -- what somebody owes
  // is a number the host acts on, in the same class as the two counts under
  // the summary line, not dispensable help text.
  owed: {
    fontFamily: type.bodyBold,
    fontSize: type.size.helper,
    color: colors.textLabel,
  },
  undoRow: {
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: colors.accent2[200],
    alignSelf: 'flex-start',
  },
  undoText: {
    fontFamily: type.bodyBold,
    fontSize: type.size.body,
    color: colors.accent2[800],
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
