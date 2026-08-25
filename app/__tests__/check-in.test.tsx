import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

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
  expect(await screen.findByText(/1 of 3 here/i)).toBeTruthy();
  expect(screen.getByText(/1 not coming/i)).toBeTruthy();
  expect(screen.getByText(/1 unaccounted/i)).toBeTruthy();
});

it('does not count a walk-in as unaccounted, and folds walk-ins into the summary denominator', async () => {
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

  // Ann (booked, arrived) + Walker (walk-in, arrived) = 2 "here". The
  // denominator has to be every known row (3), walk-in included, not just
  // the two booked rows -- `summary.here` already counts Walker's arrival,
  // so a denominator of 2 (booked only) would read as "2 of 2 here" even
  // though Bob, a booked player, is still unaccounted. Bob is the only
  // unaccounted row; a walk-in never is, regardless of state.
  expect(await screen.findByText(/2 of 3 here/i)).toBeTruthy();
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
