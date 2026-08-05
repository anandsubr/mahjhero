import { describe, expect, it } from 'vitest';
import { dateToTimeString, timeStringToDate } from './time';

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

describe('round trip', () => {
  const cases = ['00:00', '08:00', '09:05', '13:00', '21:00', '23:59'];

  for (const value of cases) {
    it(`preserves ${value} through timeStringToDate then dateToTimeString`, () => {
      expect(dateToTimeString(timeStringToDate(value))).toBe(value);
    });
  }
});
