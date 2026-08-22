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

  it('maps any other error straight to the generic message, without retrying', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied for function add_event_table' },
    });

    await expect(addEventTable('event-1')).resolves.toEqual({ error: GENERIC_ERROR });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});
