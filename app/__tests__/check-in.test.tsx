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

it('excludes people already on the list from the walk-in picker', async () => {
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
  expect(within(picker).getByText('Dee')).toBeTruthy();
  expect(within(picker).queryByText('Ann')).toBeNull();
  expect(within(picker).queryByText('Bob')).toBeNull();
  expect(within(picker).queryByText('Cal')).toBeNull();
});
