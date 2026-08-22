import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only addEventTable needs a supabase double: every other test in this file
// exercises a pure function. The chain is just `.rpc(name, args)`, so the
// mock models that directly rather than the fuller from/select/eq chain
// lib/profile.test.ts uses for table writes.
const rpcMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { GENERIC_ERROR } from './constants';
import {
  addEventTable,
  createEvent,
  createEventSeries,
  formatEventWhen,
  frequencyLabel,
  nextOccurrences,
} from './events';

describe('nextOccurrences', () => {
  it('finds the next Tuesdays from a Friday start', () => {
    // 2027-01-01 is a Friday; weekday 2 is Tuesday.
    expect(
      nextOccurrences(
        { frequency: 'weekly', weekday: 2, nthWeek: null, startsOn: '2027-01-01' },
        3,
      ),
    ).toEqual(['2027-01-05', '2027-01-12', '2027-01-19']);
  });

  it('includes the start date itself when it already matches', () => {
    // 2027-01-05 is a Tuesday.
    expect(
      nextOccurrences(
        { frequency: 'weekly', weekday: 2, nthWeek: null, startsOn: '2027-01-05' },
        2,
      ),
    ).toEqual(['2027-01-05', '2027-01-12']);
  });

  it('spaces biweekly occurrences a fortnight apart', () => {
    expect(
      nextOccurrences(
        { frequency: 'biweekly', weekday: 2, nthWeek: null, startsOn: '2027-01-01' },
        3,
      ),
    ).toEqual(['2027-01-05', '2027-01-19', '2027-02-02']);
  });

  it('skips a month with no fifth Tuesday rather than falling back', () => {
    // Fifth Tuesdays in 2027: March 30, June 29, August 31.
    expect(
      nextOccurrences(
        {
          frequency: 'monthly_nth_weekday',
          weekday: 2,
          nthWeek: 5,
          startsOn: '2027-01-01',
        },
        3,
      ),
    ).toEqual(['2027-03-30', '2027-06-29', '2027-08-31']);
  });

  it('reads -1 as the last weekday of the month', () => {
    expect(
      nextOccurrences(
        {
          frequency: 'monthly_nth_weekday',
          weekday: 2,
          nthWeek: -1,
          startsOn: '2027-01-01',
        },
        3,
      ),
    ).toEqual(['2027-01-26', '2027-02-23', '2027-03-30']);
  });

  it('clamps to endsOn inclusive: weekly Tuesday ends exactly on an occurrence', () => {
    // Verified against the live series_occurrence_dates: weekly Tuesday,
    // starts_on 2027-01-05, ends_on 2027-01-12 -> exactly two dates. Before
    // the clamp this returned three, overstating the series on the very
    // screen that collects the end date.
    expect(
      nextOccurrences(
        {
          frequency: 'weekly',
          weekday: 2,
          nthWeek: null,
          startsOn: '2027-01-05',
          endsOn: '2027-01-12',
        },
        3,
      ),
    ).toEqual(['2027-01-05', '2027-01-12']);
  });

  it('clamps to endsOn when it falls between two occurrences', () => {
    // Verified against series_occurrence_dates with the same rule and
    // ends_on 2027-01-10 (between the Jan 5 and Jan 12 Tuesdays) -> one date.
    expect(
      nextOccurrences(
        {
          frequency: 'weekly',
          weekday: 2,
          nthWeek: null,
          startsOn: '2027-01-05',
          endsOn: '2027-01-10',
        },
        3,
      ),
    ).toEqual(['2027-01-05']);
  });

  it('clamps biweekly occurrences to endsOn inclusive', () => {
    // Verified against series_occurrence_dates: biweekly Tuesday, starts_on
    // 2027-01-01, ends_on 2027-01-19 -> two dates (Jan 5 and Jan 19).
    expect(
      nextOccurrences(
        {
          frequency: 'biweekly',
          weekday: 2,
          nthWeek: null,
          startsOn: '2027-01-01',
          endsOn: '2027-01-19',
        },
        3,
      ),
    ).toEqual(['2027-01-05', '2027-01-19']);
  });

  it('clamps monthly_nth_weekday occurrences to endsOn between two occurrences', () => {
    // Verified against series_occurrence_dates: 5th Tuesday, starts_on
    // 2027-01-01, ends_on 2027-07-01 -> March 30 and June 29 only (August 31
    // falls after the end date).
    expect(
      nextOccurrences(
        {
          frequency: 'monthly_nth_weekday',
          weekday: 2,
          nthWeek: 5,
          startsOn: '2027-01-01',
          endsOn: '2027-07-01',
        },
        3,
      ),
    ).toEqual(['2027-03-30', '2027-06-29']);
  });

  it('does not clamp when endsOn is null', () => {
    expect(
      nextOccurrences(
        {
          frequency: 'weekly',
          weekday: 2,
          nthWeek: null,
          startsOn: '2027-01-01',
          endsOn: null,
        },
        3,
      ),
    ).toEqual(['2027-01-05', '2027-01-12', '2027-01-19']);
  });

  it('does not drift across a DST boundary', () => {
    // The dates are club-local calendar dates and carry no instant, so the
    // sequence must be unaffected by the machine's timezone or by the US
    // shift on 2027-03-14. This is the client-side half of the same
    // guarantee series_occurrence_dates makes in SQL.
    expect(
      nextOccurrences(
        { frequency: 'weekly', weekday: 0, nthWeek: null, startsOn: '2027-03-07' },
        3,
      ),
    ).toEqual(['2027-03-07', '2027-03-14', '2027-03-21']);
  });
});

describe('formatEventWhen', () => {
  it('renders in the club timezone, not the device one', () => {
    // 2027-09-08 00:00 UTC is 2027-09-07 20:00 in New York.
    const label = formatEventWhen('2027-09-08T00:00:00Z', 'America/New_York');
    expect(label).toContain('Tue');
    expect(label).toContain('7 Sep');
    expect(label).toMatch(/8:00\s?pm/i);
  });

  it('gives a different answer for a different club timezone', () => {
    const ny = formatEventWhen('2027-09-08T00:00:00Z', 'America/New_York');
    const la = formatEventWhen('2027-09-08T00:00:00Z', 'America/Los_Angeles');
    expect(ny).not.toEqual(la);
  });
});

describe('frequencyLabel', () => {
  it('names each rhythm in words a host would use', () => {
    expect(frequencyLabel('weekly', 2, null)).toBe('Every Tuesday');
    expect(frequencyLabel('biweekly', 2, null)).toBe('Every other Tuesday');
    expect(frequencyLabel('monthly_nth_weekday', 2, 1)).toBe(
      'The 1st Tuesday of the month',
    );
    expect(frequencyLabel('monthly_nth_weekday', 2, -1)).toBe(
      'The last Tuesday of the month',
    );
  });
});

describe('createEvent', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  const validInput = {
    clubId: 'club-1',
    title: 'Tuesday Mahjong',
    venueId: 'venue-1',
    notes: '',
    startsAt: '2027-09-07T23:00:00Z',
    endsAt: '2027-09-08T02:00:00Z',
    tableCount: 2,
  };

  it('rejects a blank title with a friendly message, before ever calling the RPC', async () => {
    await expect(createEvent({ ...validInput, title: '   ' })).resolves.toEqual({
      eventId: null,
      error: 'Give the game a name.',
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  // MINOR 7: title is validated with `.trim()` before the RPC call. The
  // create screen only ever supplies a string, but a caller further from
  // TypeScript's checking (or a stale/untyped bundle) could hand this a
  // `null` — and lib/'s never-rejects convention (see the block comment
  // above toClubEvent) means that must come back as `{ error }`, not an
  // unhandled rejection that strands the screen on a spinner.
  it('never rejects, even when title is not actually a string at runtime', async () => {
    await expect(
      createEvent({ ...validInput, title: null as unknown as string }),
    ).resolves.toEqual({ eventId: null, error: GENERIC_ERROR });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('createEventSeries', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  const validInput = {
    clubId: 'club-1',
    title: 'Weekly Mahjong',
    venueId: 'venue-1',
    notes: '',
    frequency: 'weekly' as const,
    weekday: 2,
    nthWeek: null,
    startTime: '19:00:00',
    durationMinutes: 180,
    tableCount: 1,
    startsOn: '2027-01-01',
    endsOn: null,
  };

  it('rejects a blank title with a friendly message, before ever calling the RPC', async () => {
    await expect(createEventSeries({ ...validInput, title: '   ' })).resolves.toEqual({
      seriesId: null,
      error: 'Give the game a name.',
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('never rejects, even when title is not actually a string at runtime', async () => {
    await expect(
      createEventSeries({ ...validInput, title: null as unknown as string }),
    ).resolves.toEqual({ seriesId: null, error: GENERIC_ERROR });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe('addEventTable', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('succeeds on the first try when nothing collides', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'table-1', error: null });

    await expect(addEventTable('event-1')).resolves.toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('add_event_table', {
      target_event: 'event-1',
    });
  });

  it('retries past a unique-position collision from a concurrent add', async () => {
    // Two concurrent adds computing the same next position hit
    // `unique (event_id, position)`; the loser's retry reads the position
    // the winner's insert just left behind, so it should succeed.
    rpcMock
      .mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "event_tables_event_id_position_key"' },
      })
      .mockResolvedValueOnce({ data: 'table-2', error: null });

    await expect(addEventTable('event-1')).resolves.toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('never surfaces a raw 23505 to the caller, even once every retry collides', async () => {
    // The constraint doing its job is not something to show a host. After
    // exhausting its retries this must fall back to the generic message —
    // never the Postgres code or the constraint-violation text.
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    });

    const result = await addEventTable('event-1');
    expect(result.error).toBe(GENERIC_ERROR);
    expect(result.error).not.toContain('23505');
    expect(result.error).not.toMatch(/duplicate|constraint/i);
  });

  it('maps the table cap (23514) to a message that says so, not "Something went wrong"', async () => {
    // add_event_table raises 23514 ('too many tables') at 20 tables. A host
    // at the cap deserves to be told that, the way createVenue's 23505
    // mapping tells a host about a duplicate name — not the generic
    // catch-all, and not retried like the 23505 race.
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: 'too many tables' },
    });

    const result = await addEventTable('event-1');
    expect(result.error).not.toBe(GENERIC_ERROR);
    expect(result.error).toMatch(/20 tables|maximum/i);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('maps any other error straight to the generic message, without retrying', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied for function add_event_table' },
    });

    await expect(addEventTable('event-1')).resolves.toEqual({ error: GENERIC_ERROR });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
