import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import {
  attendanceSummary,
  checkInOpen,
  clearAttendance,
  fetchEventAttendance,
  recordAttendance,
} from './attendance';
import type { AttendanceRow } from './attendance';
import { bookingErrorMessage } from './bookings';
import { GENERIC_ERROR } from './constants';

// Not `beforeEach(() => rpc.mockReset())`: mockReset() returns the mock
// function itself, and Vitest treats a value returned from a hook as an
// implicit teardown callback — it would call rpc() again after each test,
// invoking whatever implementation the test just configured. Harmless for
// bookings.test.ts's rpc mock (which only ever resolves), but here a test
// that configures a rejection would leave an unhandled rejected promise
// behind. The block body returns undefined, so no teardown is registered.
beforeEach(() => {
  rpc.mockReset();
});

function row(over: Partial<AttendanceRow> = {}): AttendanceRow {
  return {
    profile_id: 'p1',
    display_name: 'Ann',
    skill_level: null,
    event_table_id: 't1',
    table_label: 'Table 1',
    table_position: 1,
    booking_status: 'confirmed',
    state: null,
    recorded_by: null,
    recorded_at: null,
    ...over,
  };
}

describe('checkInOpen', () => {
  const now = new Date('2026-08-25T19:30:00Z');

  it('is closed when the event never asked for check-in', () => {
    expect(checkInOpen(null, null, now)).toBe(false);
  });

  it('is open inside the window', () => {
    expect(
      checkInOpen('2026-08-25T18:00:00Z', '2026-08-25T22:00:00Z', now),
    ).toBe(true);
  });

  it('is closed before it opens', () => {
    expect(
      checkInOpen('2026-08-25T20:00:00Z', '2026-08-25T23:00:00Z', now),
    ).toBe(false);
  });

  it('is closed after it shuts', () => {
    expect(
      checkInOpen('2026-08-25T15:00:00Z', '2026-08-25T18:00:00Z', now),
    ).toBe(false);
  });
});

describe('attendanceSummary', () => {
  it('counts a walk-in separately from the booked', () => {
    const s = attendanceSummary([
      row({ profile_id: 'a', state: 'arrived' }),
      row({ profile_id: 'b', state: 'no_show' }),
      row({ profile_id: 'c', state: null }),
      row({ profile_id: 'd', state: 'arrived', booking_status: null }),
    ]);
    expect(s).toEqual({
      notComing: 1,
      unaccounted: 1,
      walkIns: 1,
      booked: 3,
    });
  });

  it('does not count a walk-in as unaccounted', () => {
    // A walk-in with no state cannot exist — the row only exists because
    // somebody recorded them — but the counter must not invent one if the
    // read ever races.
    const s = attendanceSummary([row({ booking_status: null, state: null })]);
    expect(s.unaccounted).toBe(0);
  });
});

describe('fetchEventAttendance', () => {
  it('returns the rows on success', async () => {
    const rows = [row()];
    rpc.mockResolvedValue({ data: rows, error: null });
    expect(await fetchEventAttendance('e1')).toEqual(rows);
    expect(rpc).toHaveBeenCalledWith('event_attendance', { target_event: 'e1' });
  });

  it('returns null rather than an empty list when the read fails', async () => {
    // null and [] mean different things to the door screen: "could not
    // load" versus "nobody is on the list". lib/bookings.test.ts's
    // fetchEventSeating test guards the identical distinction.
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await fetchEventAttendance('e1')).toBeNull();
  });

  it('returns null when the RPC throws rather than returning an error', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    expect(await fetchEventAttendance('e1')).toBeNull();
  });
});

describe('recordAttendance', () => {
  it('passes the arguments the RPC expects, and does not send occurred_at', async () => {
    rpc.mockResolvedValue({ error: null });
    const result = await recordAttendance({
      eventId: 'e1',
      profileId: 'p1',
      state: 'arrived',
    });
    expect(rpc).toHaveBeenCalledWith('record_attendance', {
      target_event: 'e1',
      target_profile: 'p1',
      new_state: 'arrived',
    });
    // occurred_at defaults and clamps server-side
    // (20260827030000_attendance_mutations.sql); the client must never send
    // it. Check the call's argument object directly rather than trusting
    // toHaveBeenCalledWith's shape match to catch an extra key.
    expect(Object.keys(rpc.mock.calls[0][1])).not.toContain('occurred_at');
    expect(result).toEqual({ error: null });
  });

  it('maps a returned refusal through bookingErrorMessage, not the raw message', async () => {
    const pgError = { code: '23514', message: 'check-in is not enabled for this event' };
    rpc.mockResolvedValue({ error: pgError });
    const { error } = await recordAttendance({
      eventId: 'e1',
      profileId: 'p1',
      state: 'arrived',
    });
    expect(error).toBe(bookingErrorMessage(pgError));
    expect(error).toBe('This game does not use check-in.');
    expect(error).not.toBe(pgError.message);
  });

  it('returns GENERIC_ERROR when the RPC throws rather than propagating', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    const { error } = await recordAttendance({
      eventId: 'e1',
      profileId: 'p1',
      state: 'arrived',
    });
    expect(error).toBe(GENERIC_ERROR);
  });
});

describe('clearAttendance', () => {
  it('passes the arguments the RPC expects, and does not send occurred_at', async () => {
    rpc.mockResolvedValue({ error: null });
    const result = await clearAttendance({ eventId: 'e1', profileId: 'p1' });
    expect(rpc).toHaveBeenCalledWith('clear_attendance', {
      target_event: 'e1',
      target_profile: 'p1',
    });
    expect(Object.keys(rpc.mock.calls[0][1])).not.toContain('occurred_at');
    expect(result).toEqual({ error: null });
  });

  it('maps a returned refusal through bookingErrorMessage, not the raw message', async () => {
    const pgError = { code: '23514', message: 'check-in is not enabled for this event' };
    rpc.mockResolvedValue({ error: pgError });
    const { error } = await clearAttendance({ eventId: 'e1', profileId: 'p1' });
    expect(error).toBe(bookingErrorMessage(pgError));
    expect(error).toBe('This game does not use check-in.');
    expect(error).not.toBe(pgError.message);
  });

  it('returns GENERIC_ERROR when the RPC throws rather than propagating', async () => {
    rpc.mockRejectedValue(new Error('network down'));
    const { error } = await clearAttendance({ eventId: 'e1', profileId: 'p1' });
    expect(error).toBe(GENERIC_ERROR);
  });
});
