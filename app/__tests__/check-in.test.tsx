import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const searchParams: Record<string, string> = { id: 'club-1', eventId: 'event-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useLocalSearchParams: () => searchParams,
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'test-user' } },
    loading: false,
  }),
);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const fetchRoster = vi.fn();

// `canInvite` stays real -- it is pure, and it is the exact host-or-
// co-organizer test this screen is supposed to reuse rather than
// reimplementing its own notion of "organizer" (see
// app/clubs/[id]/events/[eventId]/index.tsx:113 and this repo's
// events-detail.test.tsx, which does the same).
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchRoster: (...args: unknown[]) => fetchRoster(...args),
  };
});

const fetchEvent = vi.fn();

vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchEvent: (...args: unknown[]) => fetchEvent(...args),
  };
});

const fetchEventAttendance = vi.fn();
const recordAttendance = vi.fn();
const clearAttendance = vi.fn();

vi.mock('../../lib/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/attendance')>();
  return {
    ...actual,
    fetchEventAttendance: (...args: unknown[]) => fetchEventAttendance(...args),
    recordAttendance: (...args: unknown[]) => recordAttendance(...args),
    clearAttendance: (...args: unknown[]) => clearAttendance(...args),
  };
});

import CheckInScreen from '../clubs/[id]/events/[eventId]/check-in';
import type { AttendanceRow } from '../../lib/attendance';

function row(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    profile_id: 'p1',
    display_name: 'Person',
    skill_level: null,
    event_table_id: null,
    table_label: null,
    table_position: null,
    booking_status: 'confirmed',
    state: null,
    recorded_by: null,
    recorded_at: null,
    ...over,
  };
}

const HOST = {
  profile_id: 'test-user',
  role: 'host' as const,
  display_name: 'Ada',
  skill_level: null,
};

// A window that is open right now: starts_at an hour ago (inside the
// 1-hour early-arrival lead), ends_at two hours from now. Real-clock based
// (not a fixed date) so the suite keeps passing regardless of when it runs.
const NOW = Date.now();
const EVENT = {
  id: 'event-1',
  starts_at: new Date(NOW - 30 * 60_000).toISOString(),
  ends_at: new Date(NOW + 2 * 60 * 60_000).toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.id = 'club-1';
  searchParams.eventId = 'event-1';
  useSessionMock.mockReturnValue({
    session: { user: { id: 'test-user' } },
    loading: false,
  });
  fetchRoster.mockResolvedValue([HOST]);
  fetchEvent.mockResolvedValue(EVENT);
  fetchEventAttendance.mockResolvedValue([]);
  recordAttendance.mockResolvedValue({ error: null });
  clearAttendance.mockResolvedValue({ error: null });
});

it('summarises the room above the tables', async () => {
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: 'Ann', state: 'arrived' }),
    row({ profile_id: 'b', display_name: 'Bob', state: null }),
    row({ profile_id: 'c', display_name: 'Cal', state: 'no_show' }),
  ]);
  render(<CheckInScreen />);
  // All three rows are booked (no walk-ins), so the denominator is 3 and
  // there are 0 walk-ins to call out separately.
  expect(await screen.findByText(/1 of 3 booked here/i)).toBeTruthy();
  expect(screen.getByText(/0 walk-ins/i)).toBeTruthy();
  expect(screen.getByText(/1 not coming/i)).toBeTruthy();
  expect(screen.getByText(/1 unaccounted/i)).toBeTruthy();
});

it('keeps a stable booked denominator as walk-ins arrive, and counts walk-ins separately', async () => {
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: 'Ann', state: 'arrived' }),
    row({ profile_id: 'b', display_name: 'Bob', state: null }),
    row({
      profile_id: 'w',
      display_name: 'Walker',
      booking_status: null,
      state: 'arrived',
    }),
  ]);
  render(<CheckInScreen />);

  // Only Ann is both booked and arrived, out of 2 booked rows (Ann, Bob) --
  // Walker is a walk-in, so folding him into either side of the "booked"
  // fraction would either inflate the numerator past a meaning tied to
  // bookings, or (the old bug) grow the denominator every time somebody
  // walked in, so the fraction never converged on the number the host set
  // out to reach. Walker is surfaced instead as his own count.
  expect(await screen.findByText(/1 of 2 booked here/i)).toBeTruthy();
  expect(screen.getByText(/1 walk-in\b/i)).toBeTruthy();
  expect(screen.getByText(/0 not coming/i)).toBeTruthy();
  expect(screen.getByText(/1 unaccounted/i)).toBeTruthy();
});

it('groups people under their table', async () => {
  fetchEventAttendance.mockResolvedValue([
    row({
      profile_id: 'a',
      display_name: 'Ann',
      event_table_id: 'table-1',
      table_label: 'Table 1',
      table_position: 1,
    }),
    row({
      profile_id: 'b',
      display_name: 'Bob',
      event_table_id: 'table-2',
      table_label: 'Table 2',
      table_position: 2,
    }),
  ]);
  render(<CheckInScreen />);

  const table1 = await screen.findByTestId('door-table-table-1');
  const table2 = await screen.findByTestId('door-table-table-2');
  expect(within(table1).getByText('Ann')).toBeTruthy();
  expect(within(table1).queryByText('Bob')).toBeNull();
  expect(within(table2).getByText('Bob')).toBeTruthy();
  expect(within(table2).queryByText('Ann')).toBeNull();
});

it('puts a walk-in in its own group, not at a table', async () => {
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'w', display_name: 'Walker', booking_status: null }),
  ]);
  render(<CheckInScreen />);

  const walkIns = await screen.findByTestId('door-walkins');
  expect(within(walkIns).getByText('Walker')).toBeTruthy();
});

it('records a tap without waiting for a refetch', async () => {
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: 'Ann' }),
  ]);
  // Never resolves -- proves the UI does not wait on the round trip.
  recordAttendance.mockImplementation(() => new Promise(() => {}));
  render(<CheckInScreen />);

  const hereButton = await screen.findByRole('button', { name: /here: ann/i });
  fireEvent.click(hereButton);

  expect(hereButton.getAttribute('aria-pressed')).toBe('true');
  expect(recordAttendance).toHaveBeenCalledWith({
    eventId: 'event-1',
    profileId: 'a',
    state: 'arrived',
  });
});

it('restores the previous state when the write fails', async () => {
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: 'Ann' }),
  ]);
  recordAttendance.mockResolvedValue({ error: 'nope' });
  render(<CheckInScreen />);

  const hereButton = await screen.findByRole('button', { name: /here: ann/i });
  fireEvent.click(hereButton);

  await vi.waitFor(() =>
    expect(hereButton.getAttribute('aria-pressed')).toBe('false'),
  );
  expect(await screen.findByText('nope')).toBeTruthy();
  // A refusal is authoritative: the screen refetches rather than trusting
  // the rolled-back local state.
  await vi.waitFor(() =>
    expect(fetchEventAttendance).toHaveBeenCalledTimes(2),
  );
});

it('does not clobber a different profile\'s in-flight write with a refusal\'s refetch', async () => {
  // The exact sequence from the review finding: host taps Ann, then Bob.
  // Ann's write is refused, which fires a refetch (`load()`). That refetch
  // resolves BEFORE Bob's write has committed -- reproduced here by holding
  // Bob's `recordAttendance` open on a promise we resolve by hand, after
  // the refetch has already landed. The server snapshot the refetch reads
  // still shows Bob unmarked, since it hasn't seen his write yet.
  const initialRows = [
    row({ profile_id: 'a', display_name: 'Ann', state: null }),
    row({ profile_id: 'b', display_name: 'Bob', state: null }),
  ];
  fetchEventAttendance.mockResolvedValue(initialRows);
  render(<CheckInScreen />);

  const annButton = await screen.findByRole('button', { name: /here: ann/i });
  const bobButton = await screen.findByRole('button', { name: /here: bob/i });

  let resolveBobWrite!: (v: { error: string | null }) => void;
  const bobWrite = new Promise<{ error: string | null }>((resolve) => {
    resolveBobWrite = resolve;
  });
  recordAttendance.mockImplementation((input: { profileId: string }) =>
    input.profileId === 'a' ? Promise.resolve({ error: 'nope' }) : bobWrite,
  );

  fireEvent.click(annButton);
  fireEvent.click(bobButton);

  // Ann's write is refused and its refetch lands.
  await vi.waitFor(() =>
    expect(fetchEventAttendance).toHaveBeenCalledTimes(2),
  );
  await vi.waitFor(() =>
    expect(annButton.getAttribute('aria-pressed')).toBe('false'),
  );

  // Bob's write is still in flight when that refetch resolves. His
  // optimistic "Here" must survive it.
  expect(bobButton.getAttribute('aria-pressed')).toBe('true');

  // Bob's write now lands successfully -- nothing should regress.
  resolveBobWrite({ error: null });
  await vi.waitFor(() =>
    expect(bobButton.getAttribute('aria-busy')).toBe('false'),
  );
  expect(bobButton.getAttribute('aria-pressed')).toBe('true');
});

it('lets a table move land through an in-flight write, without reverting to the old table', async () => {
  // A co-organizer moves Bob to a different table while Bob's own
  // check-in write is in flight. The refusal-triggered refetch (fired by
  // Ann's write below, same mechanism as the cross-profile test above)
  // carries Bob's NEW table. Only `state` is contested while Bob's write
  // is outstanding -- the merge must not also revert his table assignment
  // back to wherever he was before the move.
  const initialRows = [
    row({ profile_id: 'a', display_name: 'Ann', state: null }),
    row({
      profile_id: 'b',
      display_name: 'Bob',
      state: null,
      event_table_id: 'table-1',
      table_label: 'Table 1',
      table_position: 1,
    }),
  ];
  fetchEventAttendance.mockResolvedValueOnce(initialRows).mockResolvedValueOnce([
    row({ profile_id: 'a', display_name: 'Ann', state: null }),
    row({
      profile_id: 'b',
      display_name: 'Bob',
      state: null,
      event_table_id: 'table-2',
      table_label: 'Table 2',
      table_position: 1,
    }),
  ]);
  render(<CheckInScreen />);

  const annButton = await screen.findByRole('button', { name: /here: ann/i });
  const bobButton = await screen.findByRole('button', { name: /here: bob/i });

  let resolveBobWrite!: (v: { error: string | null }) => void;
  const bobWrite = new Promise<{ error: string | null }>((resolve) => {
    resolveBobWrite = resolve;
  });
  recordAttendance.mockImplementation((input: { profileId: string }) =>
    input.profileId === 'a' ? Promise.resolve({ error: 'nope' }) : bobWrite,
  );

  fireEvent.click(annButton);
  fireEvent.click(bobButton);

  await vi.waitFor(() =>
    expect(fetchEventAttendance).toHaveBeenCalledTimes(2),
  );
  await vi.waitFor(() =>
    expect(annButton.getAttribute('aria-pressed')).toBe('false'),
  );

  // Bob moved to Table 2 -- the merge kept the server's table instead of
  // reverting it alongside preserving his contested `state`. Bob's row is
  // a fresh DOM node under its new group, so re-query it there rather than
  // reuse the (now-detached) reference from before the move.
  const table2 = await screen.findByTestId('door-table-table-2');
  expect(screen.queryByTestId('door-table-table-1')).toBeNull();
  const bobButtonAtTable2 = within(table2).getByRole('button', {
    name: /here: bob/i,
  });
  expect(bobButtonAtTable2.getAttribute('aria-pressed')).toBe('true');

  resolveBobWrite({ error: null });
  await vi.waitFor(() =>
    expect(bobButtonAtTable2.getAttribute('aria-busy')).toBe('false'),
  );
});

it('keeps the correction from a same-row double-tap, even when the first write fails and refetches', async () => {
  // Routine at a door: mis-tap "Here", then immediately correct to "Not
  // coming" -- both taps land in the same event-loop turn, before React
  // repaints the disabled state from write #1's `busy`, so both writes are
  // genuinely in flight together (wrapping both `fireEvent.click`s in one
  // `act` reproduces that: neither click sees the other's pending update).
  // `busy` used to be a boolean cleared unconditionally by whichever write
  // finished first: write #1 finishing (success OR failure) dropped the
  // guard for this profile while write #2's outcome was still unknown, and
  // if write #1 FAILED, its rollback -- built from a `previous` closure
  // captured before write #2 even existed -- overwrote write #2's
  // optimistic value outright, on top of leaving the guard down for
  // whatever refetch that failure's own `load()` call kicks off.
  const initialRows = [row({ profile_id: 'a', display_name: 'Ann', state: null })];
  fetchEventAttendance.mockResolvedValue(initialRows);
  render(<CheckInScreen />);

  const hereButton = await screen.findByRole('button', { name: /here: ann/i });
  const notComingButton = await screen.findByRole('button', {
    name: /not coming: ann/i,
  });

  let resolveWrite1!: (v: { error: string | null }) => void;
  let resolveWrite2!: (v: { error: string | null }) => void;
  const write1 = new Promise<{ error: string | null }>((resolve) => {
    resolveWrite1 = resolve;
  });
  const write2 = new Promise<{ error: string | null }>((resolve) => {
    resolveWrite2 = resolve;
  });
  let calls = 0;
  recordAttendance.mockImplementation(() => {
    calls += 1;
    return calls === 1 ? write1 : write2;
  });

  // Both taps fire before either write settles or React repaints --
  // reproducing the door mis-tap-then-correct sequence.
  act(() => {
    fireEvent.click(hereButton);
    fireEvent.click(notComingButton);
  });

  expect(recordAttendance).toHaveBeenCalledTimes(2);
  expect(notComingButton.getAttribute('aria-pressed')).toBe('true');
  expect(hereButton.getAttribute('aria-pressed')).toBe('false');

  // Write #1 (the mis-tap) is refused. Its failure fires its own refetch
  // (`load()`); the server snapshot it reads still shows Ann's original
  // `null`, since neither write has committed yet.
  resolveWrite1({ error: 'nope' });
  await vi.waitFor(() =>
    expect(fetchEventAttendance).toHaveBeenCalledTimes(2),
  );

  // Write #2's optimistic "Not coming" must survive both write #1's stale
  // rollback and the refetch that landed while write #2 was still on the
  // wire -- the busy guard for Ann must still be up because write #2 has
  // not resolved yet.
  expect(notComingButton.getAttribute('aria-pressed')).toBe('true');
  expect(hereButton.getAttribute('aria-pressed')).toBe('false');
  expect(notComingButton.getAttribute('aria-busy')).toBe('true');

  // Write #2 now lands successfully -- nothing should regress, and the
  // guard should finally clear now that the LAST write for this profile
  // has resolved.
  resolveWrite2({ error: null });
  await vi.waitFor(() =>
    expect(notComingButton.getAttribute('aria-busy')).toBe('false'),
  );
  expect(notComingButton.getAttribute('aria-pressed')).toBe('true');
  expect(hereButton.getAttribute('aria-pressed')).toBe('false');
});

it('shows a true message instead of an empty room when the attendance read fails', async () => {
  fetchEventAttendance.mockResolvedValue(null);
  render(<CheckInScreen />);

  expect(
    await screen.findByText(/could not load who is booked for this game/i),
  ).toBeTruthy();
  // The old behaviour: `?? []` made a failed read look exactly like a
  // genuinely empty game.
  expect(screen.queryByText(/0 of 0 here/i)).toBeNull();
});

it('does not claim check-in is closed when it was the event read that failed', async () => {
  fetchEvent.mockResolvedValue(null);
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: 'Ann' }),
  ]);
  render(<CheckInScreen />);

  await screen.findByText('Ann');
  expect(
    await screen.findByText(/could not confirm whether check-in is open/i),
  ).toBeTruthy();
  // The old behaviour said "Check-in is closed for this game" -- a false
  // statement about the EVENT when the actual problem was the fetch.
  expect(screen.queryByText(/check-in is closed for this game/i)).toBeNull();
});

it('keeps a previously-confirmed check-in window open through a later failed event refetch', async () => {
  // Any refused write anywhere on this screen calls `load()` again (see
  // `setState`/`addWalkIn`). A previously-known window used to be nulled
  // out the moment THAT refetch's own event read happened to fail --
  // silently locking the door for a host who was checking people in
  // seconds earlier, over one flaky read that had nothing to do with the
  // write that triggered it.
  let eventCalls = 0;
  fetchEvent.mockImplementation(() => {
    eventCalls += 1;
    return Promise.resolve(eventCalls === 1 ? EVENT : null);
  });
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: 'Ann', state: null }),
  ]);
  recordAttendance.mockResolvedValue({ error: 'nope' });
  render(<CheckInScreen />);

  const hereButton = await screen.findByRole('button', { name: /here: ann/i });
  expect(hereButton.getAttribute('aria-disabled')).not.toBe('true');

  // The write fails, which fires `load()` again -- this time the event
  // read inside that refetch is the one that fails.
  fireEvent.click(hereButton);
  await vi.waitFor(() => expect(fetchEvent).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(hereButton.getAttribute('aria-pressed')).toBe('false'),
  );

  // The window that was already confirmed open must stay open -- a
  // transient failure on a LATER read must not blank a window this screen
  // already knows.
  expect(hereButton.getAttribute('aria-disabled')).not.toBe('true');
  expect(
    screen.queryByText(/could not confirm whether check-in is open/i),
  ).toBeNull();
});

it('disables every control once the window has closed', async () => {
  fetchEvent.mockResolvedValue({
    ...EVENT,
    starts_at: new Date(NOW - 100 * 86_400_000).toISOString(),
    ends_at: new Date(NOW - 100 * 86_400_000).toISOString(),
  });
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: 'Ann' }),
  ]);
  render(<CheckInScreen />);

  const hereButton = await screen.findByRole('button', { name: /here: ann/i });
  expect(hereButton.getAttribute('aria-disabled')).toBe('true');

  fireEvent.click(hereButton);
  expect(recordAttendance).not.toHaveBeenCalled();
});

it('excludes people already on the list from the walk-in picker, and pins the exact candidate set', async () => {
  fetchRoster.mockResolvedValue([
    HOST,
    { profile_id: 'a', role: 'member' as const, display_name: 'Ann', skill_level: null },
    { profile_id: 'b', role: 'member' as const, display_name: 'Bob', skill_level: null },
    { profile_id: 'c', role: 'member' as const, display_name: 'Cal', skill_level: null },
    { profile_id: 'd', role: 'member' as const, display_name: 'Dee', skill_level: null },
  ]);
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: 'Ann' }),
    row({ profile_id: 'b', display_name: 'Bob' }),
    row({ profile_id: 'c', display_name: 'Cal' }),
  ]);
  render(<CheckInScreen />);
  await screen.findByText('Ann');

  fireEvent.click(screen.getByLabelText('Add a walk-in'));
  const picker = screen.getByTestId('walkin-picker');

  // The roster has 5 people (HOST/Ada plus a/b/c/d); Ann, Bob and Cal are
  // already on the door list (the three confirmed rows above), so they are
  // excluded. That leaves exactly TWO candidates, not the one a headcount
  // of "roster minus the door list's members" might assume: Dee, who was
  // never on the list, AND Ada -- the organizer herself, who is on the
  // roster and also not yet on the list. The exclusion rule is "already
  // listed", not "not the organizer", so Ada is offered too. Asserting the
  // full set (rather than only Ann/Bob/Cal's absence) is what pins that
  // rule instead of three incidental absences that would also pass if the
  // picker, say, showed nobody at all.
  const candidateLabels = within(picker)
    .getAllByLabelText(/^Add /)
    .map((el) => el.getAttribute('aria-label'));
  expect(candidateLabels.sort()).toEqual(['Add Ada', 'Add Dee']);
});

it('reads the busy guard at the moment the refetch response arrives, not whenever React flushes the merge', async () => {
  // A different profile's failure fires the refetch (`load()`); Ann's own
  // write is what has to survive it. `load()` awaits `Promise.all([...])`,
  // which structurally settles a few microtask hops later than a bare
  // `await` on Ann's write -- so resolving the refetch and Ann's write
  // "together" and giving Ann's write a few extra hops of its own (the
  // `.then().then().then()` below) reliably lands her write's resolution
  // in the gap between "`load()`'s `Promise.all` has resolved" and
  // "React has flushed the resulting `setRows` call" -- the exact window
  // the doc comment on `busySnapshot` in `load()` describes. Reading
  // `busyRef.current` from INSIDE the `setRows` updater (the old code)
  // sees the flag already cleared by then and lets the stale server row
  // win; capturing it synchronously before `setRows` is called (the fix)
  // does not.
  const initialRows = [
    row({ profile_id: 'a', display_name: 'Ann', state: null }),
    row({ profile_id: 'b', display_name: 'Bob', state: null }),
  ];
  let attendCalls = 0;
  let resolveRefetch!: (v: AttendanceRow[]) => void;
  const refetch = new Promise<AttendanceRow[]>((resolve) => {
    resolveRefetch = resolve;
  });
  fetchEventAttendance.mockImplementation(() => {
    attendCalls += 1;
    return attendCalls === 1 ? Promise.resolve(initialRows) : refetch;
  });

  let resolveAnnWriteRaw!: (v: { error: string | null }) => void;
  const annWriteRaw = new Promise<{ error: string | null }>((resolve) => {
    resolveAnnWriteRaw = resolve;
  });
  // Three extra hops so Ann's write settles a beat after `load()`'s
  // `Promise.all` does, landing squarely in the gap under test.
  const annWrite = annWriteRaw.then((v) => v).then((v) => v).then((v) => v);
  recordAttendance.mockImplementation((input: { profileId: string }) =>
    input.profileId === 'a' ? annWrite : Promise.resolve({ error: 'nope' }),
  );

  render(<CheckInScreen />);
  const annButton = await screen.findByRole('button', { name: /here: ann/i });
  const bobButton = await screen.findByRole('button', { name: /here: bob/i });

  fireEvent.click(annButton); // Ann's write is now in flight.
  fireEvent.click(bobButton); // Bob's write fails immediately and fires load().

  await vi.waitFor(() =>
    expect(fetchEventAttendance).toHaveBeenCalledTimes(2),
  );
  expect(annButton.getAttribute('aria-busy')).toBe('true');

  // The refetch's server snapshot (Ann still `null`) and Ann's own write
  // resolving both land in the same tick -- exactly the race the fix
  // guards against.
  act(() => {
    resolveRefetch([
      row({ profile_id: 'a', display_name: 'Ann', state: null }),
      row({ profile_id: 'b', display_name: 'Bob', state: null }),
    ]);
    resolveAnnWriteRaw({ error: null });
  });

  await vi.waitFor(() =>
    expect(annButton.getAttribute('aria-busy')).toBe('false'),
  );
  // Ann's optimistic "Here" must survive: the merge must not have applied
  // the server's stale `null` just because the busy flag cleared before
  // React got around to running the merge.
  expect(annButton.getAttribute('aria-pressed')).toBe('true');
});
