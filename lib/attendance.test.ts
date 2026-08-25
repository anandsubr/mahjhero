import { describe, expect, it } from 'vitest';
import { attendanceSummary, checkInOpen } from './attendance';
import type { AttendanceRow } from './attendance';

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
      here: 2,
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
