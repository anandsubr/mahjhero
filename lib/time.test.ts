import { describe, expect, it } from 'vitest';
import {
  addHours,
  dateStringToDate,
  dateToDateString,
  dateToTimeString,
  formatTimeLabel,
  timeStringToDate,
} from './time';

describe('timeStringToDate', () => {
  it('sets the hour and minute from an HH:MM string', () => {
    const date = timeStringToDate('21:05');
    expect(date.getHours()).toBe(21);
    expect(date.getMinutes()).toBe(5);
  });

  it('handles midnight', () => {
    const date = timeStringToDate('00:00');
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('handles a single-digit hour written with the required leading zero', () => {
    const date = timeStringToDate('09:00');
    expect(date.getHours()).toBe(9);
    expect(date.getMinutes()).toBe(0);
  });

  it('falls back to local midnight for an empty string, rather than throwing', () => {
    // A web <input type="time"> reports "" while the user is mid-edit
    // (see lib/time.ts's module doc). TimeField must stay renderable through
    // that transient state.
    const date = timeStringToDate('');
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('falls back to local midnight for a malformed string, rather than throwing', () => {
    const date = timeStringToDate('9pm');
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('returns a Date, not a mutated shared instance, across calls', () => {
    // Guards against a stray module-level Date getting reused/mutated by
    // setHours instead of copied.
    const first = timeStringToDate('21:00');
    const second = timeStringToDate('08:00');
    expect(first.getHours()).toBe(21);
    expect(second.getHours()).toBe(8);
  });
});

describe('dateToTimeString', () => {
  it('zero-pads a single-digit hour', () => {
    const date = new Date(2000, 0, 1, 9, 0);
    expect(dateToTimeString(date)).toBe('09:00');
  });

  it('zero-pads a single-digit minute', () => {
    const date = new Date(2000, 0, 1, 21, 5);
    expect(dateToTimeString(date)).toBe('21:05');
  });

  it('formats midnight as 00:00', () => {
    const date = new Date(2000, 0, 1, 0, 0);
    expect(dateToTimeString(date)).toBe('00:00');
  });

  it('formats the last minute of the day', () => {
    const date = new Date(2000, 0, 1, 23, 59);
    expect(dateToTimeString(date)).toBe('23:59');
  });
});

describe('formatTimeLabel', () => {
  // Locale pinned to 'en-US' so these are deterministic regardless of the
  // machine running them; production usage leaves locale unset so the
  // Android confirmation text follows the member's own device setting (see
  // lib/time.ts's doc comment).
  it('formats a morning hour with AM', () => {
    expect(formatTimeLabel(new Date(2000, 0, 1, 9, 0), 'en-US')).toBe('9:00 AM');
  });

  it('formats an evening hour with PM', () => {
    expect(formatTimeLabel(new Date(2000, 0, 1, 21, 0), 'en-US')).toBe('9:00 PM');
  });

  it('formats midnight as 12:00 AM, not 0:00 AM', () => {
    // The classic 12-hour-clock trap: hour 0 displays as "12", not "0".
    expect(formatTimeLabel(new Date(2000, 0, 1, 0, 0), 'en-US')).toBe('12:00 AM');
  });

  it('formats noon as 12:00 PM, not 0:00 PM', () => {
    // The other half of the same trap: hour 12 also displays as "12".
    expect(formatTimeLabel(new Date(2000, 0, 1, 12, 0), 'en-US')).toBe('12:00 PM');
  });
});

describe('round trip', () => {
  const cases = ['00:00', '08:00', '09:05', '12:00', '13:00', '21:00', '23:59'];

  for (const value of cases) {
    it(`preserves ${value} through timeStringToDate then dateToTimeString`, () => {
      expect(dateToTimeString(timeStringToDate(value))).toBe(value);
    });
  }
});

describe('addHours', () => {
  it('adds a positive offset', () => {
    expect(addHours('2026-08-25T19:00:00.000Z', 1)).toBe(
      '2026-08-25T20:00:00.000Z',
    );
  });

  it('subtracts with a negative offset', () => {
    expect(addHours('2026-08-25T19:00:00.000Z', -1)).toBe(
      '2026-08-25T18:00:00.000Z',
    );
  });

  it('carries a large offset across a day boundary', () => {
    expect(addHours('2026-08-25T19:00:00.000Z', 24)).toBe(
      '2026-08-26T19:00:00.000Z',
    );
  });

  it('is a no-op at zero', () => {
    expect(addHours('2026-08-25T19:00:00.000Z', 0)).toBe(
      '2026-08-25T19:00:00.000Z',
    );
  });
});

describe('dateStringToDate / dateToDateString', () => {
  it('round-trips a calendar date', () => {
    expect(dateToDateString(dateStringToDate('2027-03-14'))).toBe('2027-03-14');
  });

  it('builds a local date, so a picker shows the day that was typed', () => {
    const d = dateStringToDate('2027-03-14');
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(14);
  });

  it('pads single-digit months and days', () => {
    expect(dateToDateString(new Date(2027, 0, 5))).toBe('2027-01-05');
  });

  it('survives a DST boundary date', () => {
    // 2027-03-14 is the US spring-forward date. A UTC-based implementation
    // would render the 13th for anyone west of Greenwich.
    expect(dateToDateString(dateStringToDate('2027-03-14'))).toBe('2027-03-14');
  });
});
