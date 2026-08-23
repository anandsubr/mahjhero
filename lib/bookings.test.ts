import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

import {
  bookingErrorMessage,
  cancelBooking,
  commitBooking,
  fetchEventSeating,
  needsAFourth,
  offerCountdown,
  seatsRemaining,
  tierWarning,
  waitlistLabel,
} from './bookings';
import { GENERIC_ERROR } from './constants';

beforeEach(() => rpc.mockReset());

describe('tierWarning', () => {
  it('says nothing when the tier and the level agree', () => {
    expect(tierWarning('advanced', 'advanced', 'Table 2')).toBeNull();
  });

  it('says nothing about a mixed table, whoever is booking', () => {
    expect(tierWarning('mixed', 'beginner', 'Table 1')).toBeNull();
  });

  // A null skill level is the common case for a member who has never
  // opened their profile. Warning them about a mismatch they have not
  // declared would be an interruption with nothing behind it.
  it('says nothing when the member has no skill level set', () => {
    expect(tierWarning('advanced', null, 'Table 2')).toBeNull();
  });

  it('names the table and the tier when they disagree', () => {
    expect(tierWarning('advanced', 'beginner', 'Table 2')).toBe(
      'Table 2 is set up for advanced players. Book anyway?',
    );
  });
});

describe('needsAFourth', () => {
  const start = new Date('2026-08-25T23:00:00Z');

  it('is true at one seat short, inside 48 hours', () => {
    const now = new Date('2026-08-24T23:00:00Z');
    expect(needsAFourth(4, 3, start, now)).toBe(true);
  });

  it('is false two seats short', () => {
    const now = new Date('2026-08-24T23:00:00Z');
    expect(needsAFourth(4, 2, start, now)).toBe(false);
  });

  it('is false when the table is full', () => {
    const now = new Date('2026-08-24T23:00:00Z');
    expect(needsAFourth(4, 4, start, now)).toBe(false);
  });

  it('is false more than 48 hours out', () => {
    const now = new Date('2026-08-22T22:00:00Z');
    expect(needsAFourth(4, 3, start, now)).toBe(false);
  });

  // The boundary itself, because "within 48 hours" and "48 hours or more"
  // differ by exactly the case a host looks at two days ahead.
  it('is true exactly 48 hours out', () => {
    const now = new Date('2026-08-23T23:00:00Z');
    expect(needsAFourth(4, 3, start, now)).toBe(true);
  });

  it('is false once the game has started', () => {
    const now = new Date('2026-08-25T23:00:01Z');
    expect(needsAFourth(4, 3, start, now)).toBe(false);
  });
});

describe('seatsRemaining', () => {
  it('counts the seats a table has left', () => {
    expect(seatsRemaining(4, 3)).toBe(1);
  });

  // Removing a table lowers capacity without ejecting anybody, so a table
  // can hold more than it seats. Never render a negative.
  it('never goes below zero', () => {
    expect(seatsRemaining(2, 3)).toBe(0);
  });
});

describe('waitlistLabel', () => {
  it('reads as an ordinal', () => {
    expect(waitlistLabel(1)).toBe('1st on the waitlist');
    expect(waitlistLabel(2)).toBe('2nd on the waitlist');
    expect(waitlistLabel(3)).toBe('3rd on the waitlist');
    expect(waitlistLabel(4)).toBe('4th on the waitlist');
  });

  // 11th, 12th and 13th are the ones every naive ordinal function gets
  // wrong. A club big enough to reach them is a club we want.
  it('handles the teens', () => {
    expect(waitlistLabel(11)).toBe('11th on the waitlist');
    expect(waitlistLabel(12)).toBe('12th on the waitlist');
    expect(waitlistLabel(13)).toBe('13th on the waitlist');
    expect(waitlistLabel(21)).toBe('21st on the waitlist');
  });
});

describe('offerCountdown', () => {
  const expires = new Date('2026-08-24T16:15:00Z');

  it('reads in whole minutes under an hour', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T15:45:00Z'))).toBe(
      '30 minutes left',
    );
  });

  it('reads in hours and minutes above one hour', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T14:30:00Z'))).toBe(
      '1 hour 45 minutes left',
    );
  });

  it('singularises one minute', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T16:14:10Z'))).toBe(
      '1 minute left',
    );
  });

  it('is explicit once it has run out rather than counting backwards', () => {
    expect(offerCountdown(expires, new Date('2026-08-24T16:16:00Z'))).toBe(
      'Expired',
    );
  });
});

describe('fetchEventSeating', () => {
  it('returns null rather than an empty list when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    // null and [] mean different things to the screen: "could not load"
    // versus "nobody has booked". Plan 3 shipped a screen that read a
    // failed fetch as "none" and said so out loud.
    expect(await fetchEventSeating('e1')).toBeNull();
  });

  it('returns an empty list when nobody has booked', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await fetchEventSeating('e1')).toEqual([]);
  });
});

describe('commitBooking', () => {
  it('passes the arguments the RPC expects', async () => {
    rpc.mockResolvedValue({ data: { outcome: 'seated' }, error: null });
    await commitBooking({
      eventId: 'e1',
      players: ['p1'],
      preferredTableId: 't1',
      allowSplit: true,
    });
    expect(rpc).toHaveBeenCalledWith('commit_booking', {
      target_event: 'e1',
      players: ['p1'],
      preferred: 't1',
      allow_split: true,
    });
  });

  it('reports a full game as a full game, not as a connection problem', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'already booked' },
    });
    const { error } = await commitBooking({
      eventId: 'e1',
      players: ['p1'],
      preferredTableId: 't1',
      allowSplit: true,
    });
    expect(error).toBe('Someone in your group already has a seat at this game.');
    expect(error).not.toBe(GENERIC_ERROR);
  });
});

describe('bookingErrorMessage', () => {
  it('falls back to the generic message for a refusal it does not know', async () => {
    expect(bookingErrorMessage({ code: '23514', message: 'mystery' })).toBe(
      GENERIC_ERROR,
    );
  });
});

describe('cancelBooking', () => {
  it('reports a started game plainly', async () => {
    rpc.mockResolvedValue({
      error: { code: '23514', message: 'event already started' },
    });
    expect((await cancelBooking('b1')).error).toBe(
      'This game has already started.',
    );
  });
});
