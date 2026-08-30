import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const searchParams: Record<string, string> = { id: 'club-1', eventId: 'event-1' };
const push = vi.fn();
const replace = vi.fn();

// This screen's own route, never TabBar's own /clubs -- the Club tab stays
// live here the same way it does on the club detail and venues screens (see
// clubs.test.tsx's and venues.test.tsx's identical comment).
const pathname = '/clubs/club-1/events/event-1/check-in';

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
  useLocalSearchParams: () => searchParams,
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render -- see venues.test.tsx's identical
  // comment: `(cb) => cb()` would refire `useUnreadCounts`'s fetch (now
  // pulled in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
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

// TabBar (now carried by this screen) calls `useUnreadCounts`, which reaches
// `fetchUnreadCounts`.
const fetchUnreadCounts = vi.fn(async () => []);
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: () => fetchUnreadCounts(),
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
  check_in_required: true,
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

// TabBar navigates with router.replace off an entry route that is itself a
// Redirect, so the history stack is typically one deep -- a state without
// the bar strands a host with no way out but relaunching the app. See
// clubs.test.tsx's and venues.test.tsx's identical rationale. This screen
// draws no back link of its own, so there is nothing to check for
// redundancy here.
describe('screen chrome', () => {
  it('carries the tab bar once ready', async () => {
    render(<CheckInScreen />);
    expect(await screen.findByRole('button', { name: 'Club' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
  });

  it('carries the tab bar while the event is still loading', () => {
    fetchEvent.mockReturnValueOnce(new Promise(() => {}));
    fetchRoster.mockReturnValueOnce(new Promise(() => {}));
    render(<CheckInScreen />);
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  it('carries the tab bar when the viewer is not an organizer', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'member' as const, display_name: 'Ada', skill_level: null },
    ]);
    render(<CheckInScreen />);
    expect(
      await screen.findByText('You are not an organizer of this club.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });
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
  // Honest framing, since this scenario is NOT reachable through a real
  // double-tap: `CheckInControl` sets `isDisabled = disabled || busy`, and
  // once write #1's `incrBusy` commits, the control is disabled and a real
  // second tap's `press()` returns early without ever calling `onChange` --
  // the "disables every control" test below pins exactly that. Two genuine
  // browser clicks are two separate dispatched events, and React flushes
  // state between separate events even under automatic batching, so by the
  // time a real second tap's handler ran, write #1's `busy` update would
  // already be committed and the tap would be silently swallowed, not
  // "handled." Only wrapping BOTH `fireEvent.click`s in one manual `act()`
  // forces them to share a single pre-update render, which is not something
  // a real click stream can do.
  //
  // The refcount/`writeSeqRef` guard this test exercises is therefore
  // defence-in-depth for a path the current UI cannot reach, kept
  // deliberately rather than by oversight: `writeSeqRef` is the same
  // mechanism `load()`'s merge (check-in.tsx) reuses to answer "did a write
  // for this profile start after this read began" for the read-window race
  // fixed above, so it earns its keep independently of this test. And
  // dropping the rollback guard itself would be a silent regression the
  // very moment any future code path (a bulk action, a programmatic
  // dispatch, an accessibility tool invoking `onChange` directly) manages
  // to put two writes for the same profile in flight without an
  // intervening render -- nothing else in this suite would catch that.
  // What follows used to prove: `busy` was a boolean cleared unconditionally
  // by whichever write finished first, so write #1 finishing (success OR
  // failure) dropped the guard for this profile while write #2's outcome
  // was still unknown, and if write #1 FAILED, its rollback -- built from a
  // `previous` closure captured before write #2 even existed -- overwrote
  // write #2's optimistic value outright, on top of leaving the guard down
  // for whatever refetch that failure's own `load()` call kicks off.
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

// Final-review fix (item 3): display_name carries no non-empty constraint
// and defaults to '' -- an unnamed member used to render a blank row here
// ("Here: " with nothing after the colon), announcing nothing useful to a
// screen reader or a sighted host. Both the row's own label and the
// control passed to it need a fallback.
it('renders something for a nameless person instead of a blank row', async () => {
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: '' }),
  ]);
  render(<CheckInScreen />);

  expect(await screen.findByText('Unnamed member')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: /^here: unnamed member$/i }),
  ).toBeTruthy();
});

// Final-review fix (three trailing minors, item 3): the same gap as above,
// a third time -- `display_name` carries no non-empty constraint, so a
// nameless roster member offered in the walk-in picker used to render a
// blank tappable row announcing "Add " to a screen reader and showing
// nothing sighted. The picker builds its own row (a `Pressable` plus a
// bare `Text`) rather than going through `renderPerson`/`CheckInControl`,
// so it needed the same guard a third time; it now goes through the
// `safeDisplayName` helper `renderPerson` itself was extracted to share.
it('renders something for a nameless roster member in the walk-in picker instead of a blank row', async () => {
  fetchRoster.mockResolvedValue([
    HOST,
    { profile_id: 'x', role: 'member' as const, display_name: '', skill_level: null },
  ]);
  fetchEventAttendance.mockResolvedValue([]);
  render(<CheckInScreen />);
  await screen.findByLabelText('Add a walk-in');

  fireEvent.click(screen.getByLabelText('Add a walk-in'));
  const picker = screen.getByTestId('walkin-picker');

  expect(within(picker).getByText('Unnamed member')).toBeTruthy();
  expect(within(picker).getByLabelText('Add Unnamed member')).toBeTruthy();
});

// Final-review fix (Important 2): the window used to be derived from
// starts_at/ends_at ALONE, ignoring check_in_required entirely. Opening
// this screen for an event with check_in_required = false, inside the time
// window, rendered a fully "live"-looking door list -- every control and
// "Add a walk-in" enabled -- and every tap raised "This game does not use
// check-in.". Mirrors my_upcoming_bookings' own `case when
// e.check_in_required then ... end`
// (20260827070000_my_upcoming_bookings_check_in.sql:79-81): the window is
// null when the event never asked for check-in.
//
// Mutation evidence: with the `if (event.check_in_required) { ... } else {
// setOpensAt(null); setClosesAt(null); }` branch reverted to the old
// unconditional `setOpensAt(addHours(...)); setClosesAt(addHours(...))`,
// this test fails -- the "Here: ann" control renders enabled instead of
// disabled. See .superpowers/sdd/final-review-fixes-report.md.
it('treats the window as closed for an event that never asked for check-in, even inside starts_at/ends_at', async () => {
  fetchEvent.mockResolvedValue({ ...EVENT, check_in_required: false });
  fetchEventAttendance.mockResolvedValue([
    row({ profile_id: 'a', display_name: 'Ann' }),
  ]);
  render(<CheckInScreen />);

  const hereButton = await screen.findByRole('button', { name: /here: ann/i });
  expect(hereButton.getAttribute('aria-disabled')).toBe('true');

  fireEvent.click(hereButton);
  expect(recordAttendance).not.toHaveBeenCalled();

  // Says something TRUE about why -- distinct from "closed", since this
  // game was never live in the first place.
  expect(screen.getByText('This game does not use check-in.')).toBeTruthy();
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
  // the doc comment on `writeSeqAtLoadEntry`/`busyAtLoadEntry` in `load()`
  // describes. Reading `busyRef.current` from INSIDE the `setRows` updater
  // (the old code)
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

it('keeps a write that both starts AND finishes inside the read window, not just one still in flight when it lands', async () => {
  // The other ordering of the same race, and per the review the MORE
  // likely one: the test above has Bob's write already in flight when
  // load()'s entry snapshot is taken, so `busyAtLoadEntry` alone catches
  // it. Here Bob's write starts AFTER load() has already begun -- it does
  // not exist yet when the snapshot is taken -- and it both starts and
  // resolves before load()'s Promise.all settles, so `busy` for Bob is
  // back to false well before the merge runs. Only the write-sequence
  // half of `contested` (Bob's `writeSeqRef` entry compared against what
  // `load()` recorded at its own entry) can still catch this one.
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

  let resolveBobWrite!: (v: { error: string | null }) => void;
  const bobWrite = new Promise<{ error: string | null }>((resolve) => {
    resolveBobWrite = resolve;
  });
  recordAttendance.mockImplementation((input: { profileId: string }) =>
    input.profileId === 'a' ? Promise.resolve({ error: 'nope' }) : bobWrite,
  );

  render(<CheckInScreen />);
  const annButton = await screen.findByRole('button', { name: /here: ann/i });
  const bobButton = await screen.findByRole('button', { name: /here: bob/i });

  // Ann's write is refused, firing load(). Its entry snapshot is taken
  // here, before Bob has been touched at all.
  fireEvent.click(annButton);
  await vi.waitFor(() =>
    expect(fetchEventAttendance).toHaveBeenCalledTimes(2),
  );

  // Only NOW does Bob's write start -- strictly after load()'s entry
  // snapshot.
  fireEvent.click(bobButton);
  expect(bobButton.getAttribute('aria-busy')).toBe('true');

  // Bob's write both starts and finishes before the refetch's responses
  // arrive.
  resolveBobWrite({ error: null });
  await vi.waitFor(() =>
    expect(bobButton.getAttribute('aria-busy')).toBe('false'),
  );
  expect(bobButton.getAttribute('aria-pressed')).toBe('true');

  // The refetch lands last, carrying a server snapshot taken before Bob's
  // write committed -- still `null` for Bob. Ann's own rollback already
  // happened (her write settled long before this), so her `aria-pressed`
  // is `false` from that alone and cannot serve as a signal that THIS
  // merge has landed -- a bare `vi.waitFor` on it would pass instantly,
  // before the refetch's `Promise.all` chain has even had a microtask to
  // run, and the assertions below would then be checking pre-merge state
  // by accident. Force a real flush instead, long enough for that chain
  // (and React's resulting commit) to finish regardless of which way it
  // comes out, then assert the settled result directly.
  await act(async () => {
    resolveRefetch(initialRows);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(annButton.getAttribute('aria-pressed')).toBe('false');
  // Bob's choice must survive: his write sequence moved on since load()
  // started, even though nothing about him was "busy" by the time the
  // merge actually ran. Cross-checked against the summary line too: if
  // the merge had wrongly let the stale server row win, Bob would count
  // as unaccounted (2) instead of arrived, alongside Ann.
  expect(bobButton.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(/1 unaccounted/i)).toBeTruthy();
  expect(screen.queryByText(/2 unaccounted/i)).toBeNull();
});

it('does not let a walk-in vanish when its write starts after the refetch begins and finishes before it lands', async () => {
  // The aggravated variant of the same race: `addWalkIn` optimistically
  // INSERTS a row that has no server counterpart at all yet. If that
  // insert's write starts after load()'s entry snapshot and both starts
  // and finishes before load()'s responses arrive, the row is (a) not
  // "busy" by the time the merge runs, and (b) genuinely absent from the
  // server snapshot that merge is folding in -- `!serverIds.has(...)`
  // (mergeAttendance, check-in.tsx) does not re-add a row the merge does
  // not know to treat as contested. Without the write-sequence half of
  // `contested`, the person disappears from the door list outright,
  // rather than merely reverting a state.
  fetchRoster.mockResolvedValue([
    HOST,
    {
      profile_id: 'w',
      role: 'member' as const,
      display_name: 'Walker',
      skill_level: null,
    },
  ]);
  const initialRows = [
    row({ profile_id: 'a', display_name: 'Ann', state: null }),
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

  let resolveWalkInWrite!: (v: { error: string | null }) => void;
  const walkInWrite = new Promise<{ error: string | null }>((resolve) => {
    resolveWalkInWrite = resolve;
  });
  recordAttendance.mockImplementation((input: { profileId: string }) =>
    input.profileId === 'a' ? Promise.resolve({ error: 'nope' }) : walkInWrite,
  );

  render(<CheckInScreen />);
  const annButton = await screen.findByRole('button', { name: /here: ann/i });

  // Ann's write is refused, firing load(). Its entry snapshot is taken
  // before Walker is added at all.
  fireEvent.click(annButton);
  await vi.waitFor(() =>
    expect(fetchEventAttendance).toHaveBeenCalledTimes(2),
  );

  fireEvent.click(screen.getByLabelText('Add a walk-in'));
  fireEvent.click(screen.getByLabelText('Add Walker'));
  expect(await screen.findByText('Walker')).toBeTruthy();

  // Walker's write both starts and finishes before the refetch's
  // responses arrive.
  resolveWalkInWrite({ error: null });
  await vi.waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: /here: walker/i })
        .getAttribute('aria-busy'),
    ).toBe('false'),
  );

  // The refetch lands last, carrying a server snapshot taken before
  // Walker's insert committed -- Walker is entirely absent from it. Ann's
  // own rollback already happened by this point (her write settled long
  // before this), so waiting on her `aria-pressed` would pass before this
  // refetch's chain has even run a microtask -- see the sibling test
  // above for the same trap. Force a real flush instead, long enough for
  // the chain and its commit to finish either way, then assert the
  // settled result.
  await act(async () => {
    resolveRefetch(initialRows);
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  expect(annButton.getAttribute('aria-pressed')).toBe('false');
  // Walker must still be on the door list, marked arrived -- not
  // silently dropped by a merge that only knew to look at the server's
  // rows. Cross-checked against the summary line too: if the merge had
  // dropped Walker's row outright, the walk-in count would read 0.
  expect(screen.getByText('Walker')).toBeTruthy();
  expect(
    screen
      .getByRole('button', { name: /here: walker/i })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  expect(screen.getByText(/1 walk-in\b/i)).toBeTruthy();
});
