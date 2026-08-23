import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * The self-auditing test for BOOKING_REFUSALS.
 *
 * A hand-maintained refusal vocabulary rots the moment somebody adds a new
 * `raise exception` and forgets the client-side entry — which is exactly how
 * the SQLSTATE-keyed bug this file's other tests now guard against shipped
 * in the first place. This test reads the actual migration SQL rather than
 * trusting a second hand-written list, so a future raise site with no
 * mapping fails loudly here instead of silently reporting GENERIC_ERROR to
 * a member.
 *
 * Mutation evidence: run with BOOKING_REFUSALS reverted to the pre-fix,
 * code-AND-message-keyed version (single 23514 'no such table' entry, no
 * 'not a member of this club' entry), this test fails and names both
 * strings — see the task-8 report's "Fix pass" section for the transcript.
 */
describe('BOOKING_REFUSALS (self-audit against the migrations)', () => {
  // Every distinct message the day-8 migrations raise that deliberately has
  // no entry in BOOKING_REFUSALS, and the specific reason each one
  // qualifies. Two categories:
  //
  //   1. The plan's own refusal table (docs/superpowers/plans/
  //      2026-08-23-seating-and-booking.md, "Error handling") already
  //      documents these as unreachable from the UI and falls them back to
  //      GENERIC_ERROR on purpose.
  //   2. Raised by a function this module does not call. lib/events.ts
  //      calls add_event_table, remove_event_table, cancel_event and
  //      update_event_series, and owns its own RPC_ERROR_MESSAGES
  //      vocabulary for their refusals; that vocabulary is out of scope
  //      here, and the messages below are asserted to fall to GENERIC_ERROR
  //      from bookingErrorMessage specifically because bookingErrorMessage
  //      is not the vocabulary responsible for them.
  const ALLOWLIST: Record<string, string> = {
    // The player picker cannot select the same person twice; this is a
    // server-side belt for a client that already has the suspenders.
    // Plan's refusal table: "Unreachable from the UI... Falls back to the
    // generic message deliberately."
    'duplicate player':
      'deliberate fallback (plan’s refusal table) — the picker cannot select one player twice',
    // The decline control only ever renders on a seat somebody else booked.
    // Plan's refusal table: "Unreachable — the decline control is only
    // rendered on a seat somebody else booked."
    'nothing to decline':
      'deliberate fallback (plan’s refusal table) — decline is never offered on your own booking',
    // announce_table_fourth is revoked from public and anon and never
    // granted to authenticated (20260825050000) — no client path calls
    // it directly. Its own comment states the guard is unreachable because
    // both its callers (announce_need_a_fourth, call_for_a_fourth) derive
    // the stage from need_a_fourth_stage, which only ever returns 'tier' or
    // 'wide'.
    'unrecognized stage: %':
      'only reachable from an internal, non-granted function (announce_table_fourth)',
    // add_event_table / remove_event_table: called from lib/events.ts, not
    // lib/bookings.ts.
    "a cancelled event's tables cannot be edited":
      'raised by add_event_table/remove_event_table — lib/events.ts’s functions, not this module’s',
    'an event must keep at least one table':
      'raised by remove_event_table — lib/events.ts’s function, not this module’s',
    'too many tables':
      'raised by add_event_table — lib/events.ts’s function, not this module’s',
    // update_event_series: called from lib/events.ts, not lib/bookings.ts.
    'no such series':
      'raised by update_event_series — lib/events.ts’s function, not this module’s',
    'title is required':
      'raised by update_event_series — already mapped by lib/events.ts’s own RPC_ERROR_MESSAGES',
  };

  function distinctRaisedMessages(): string[] {
    const migrationsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../supabase/migrations',
    );
    const files = readdirSync(migrationsDir).filter(
      (name) => name.startsWith('20260825') && name.endsWith('.sql'),
    );
    const messages = new Set<string>();
    const raisePattern = /raise exception\s+'((?:[^']|'')*)'/g;
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      for (const match of sql.matchAll(raisePattern)) {
        // '' is SQL's escape for a literal apostrophe inside a quoted
        // string (e.g. "event''s"); normalize it back to one, matching what
        // Postgres actually puts in the error message.
        messages.add(match[1].replace(/''/g, "'"));
      }
    }
    return [...messages];
  }

  it('found at least one raise site (guards against a broken glob or regex)', () => {
    expect(distinctRaisedMessages().length).toBeGreaterThan(10);
  });

  it('maps, or explicitly allowlists, every message the migrations raise', () => {
    const unmapped = distinctRaisedMessages().filter(
      (message) =>
        !(message in ALLOWLIST) &&
        bookingErrorMessage({ code: '00000', message }) === GENERIC_ERROR,
    );
    expect(
      unmapped,
      `BOOKING_REFUSALS has no entry for: ${JSON.stringify(unmapped)}. ` +
        'Add a sentence to BOOKING_REFUSALS in lib/bookings.ts, or add a ' +
        'justified entry to this test’s ALLOWLIST.',
    ).toEqual([]);
  });

  it('never allowlists a message BOOKING_REFUSALS actually maps', () => {
    // Guards the allowlist itself against rot the other way: an entry left
    // behind after somebody adds real coverage for it.
    const stale = Object.keys(ALLOWLIST).filter(
      (message) => bookingErrorMessage({ code: '00000', message }) !== GENERIC_ERROR,
    );
    expect(stale).toEqual([]);
  });
});
