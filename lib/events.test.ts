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
  eventStartTimeInZone,
  formatEventWhen,
  frequencyLabel,
  nextOccurrences,
  updateEvent,
  updateEventSeries,
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

describe('eventStartTimeInZone', () => {
  it('reads the wall-clock time in the club timezone, not the device one', () => {
    // 2027-09-08 00:00 UTC is 20:00 the evening before in New York (EDT,
    // UTC-4, in September).
    expect(eventStartTimeInZone('2027-09-08T00:00:00Z', 'America/New_York')).toBe(
      '20:00',
    );
  });

  it('gives a different answer for a different club timezone', () => {
    const ny = eventStartTimeInZone('2027-09-08T00:00:00Z', 'America/New_York');
    const tokyo = eventStartTimeInZone('2027-09-08T00:00:00Z', 'Asia/Tokyo');
    expect(ny).not.toEqual(tokyo);
  });

  it('reads midnight as "00:00", not "24:00"', () => {
    // The reason this function uses hourCycle: 'h23' rather than
    // hour12: false — see its own doc comment. 2027-09-08 04:00 UTC is
    // exactly midnight in New York (UTC-4 in September).
    expect(eventStartTimeInZone('2027-09-08T04:00:00Z', 'America/New_York')).toBe(
      '00:00',
    );
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
    date: '2027-09-07',
    startTime: '19:00',
    durationMinutes: 180,
    tableCount: 2,
  };

  /*
   * The whole point of supabase/migrations/20260823070000: the date and the
   * wall-clock time reach Postgres as the host typed them, and the instant is
   * computed there against `clubs.timezone`. Anything that converted a
   * timezone on the way — the two failed client-side attempts this replaced —
   * would show up here as a `event_date` or `start_time` that is not what
   * went in. That the resulting instant is then the RIGHT one is pinned
   * against the real database in lib/schema-contract.test.ts, including on
   * both 2027 DST transition dates.
   */
  it('sends the club-local date and wall time through to the RPC unconverted', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'event-1', error: null });

    await expect(createEvent(validInput)).resolves.toEqual({
      eventId: 'event-1',
      error: null,
    });
    expect(rpcMock).toHaveBeenCalledWith('create_event', {
      target_club: 'club-1',
      event_title: 'Tuesday Mahjong',
      target_venue: 'venue-1',
      event_notes: '',
      event_date: '2027-09-07',
      start_time: '19:00',
      duration_minutes: 180,
      table_count: 2,
    });
  });

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

describe('updateEvent', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  /*
   * The edit screen is Task 15, so this mapping has no other caller yet —
   * which is exactly why it is pinned now. update_event was re-signatured to
   * calendar values in the same migration as create_event specifically so
   * that the edit screen cannot need a client-side conversion and reintroduce
   * the bug through a different door.
   */
  it('maps the club-local calendar fields onto the RPC parameter names', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });

    await expect(
      updateEvent('event-1', {
        date: '2027-11-07',
        startTime: '19:00',
        durationMinutes: 240,
      }),
    ).resolves.toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledWith('update_event', {
      target_event: 'event-1',
      new_title: null,
      new_venue_id: null,
      new_notes: null,
      new_date: '2027-11-07',
      new_start_time: '19:00',
      new_duration_minutes: 240,
    });
  });

  it('sends null for every field the caller left out, meaning "leave this alone"', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });

    await updateEvent('event-1', { title: 'Renamed' });
    expect(rpcMock).toHaveBeenCalledWith('update_event', {
      target_event: 'event-1',
      new_title: 'Renamed',
      new_venue_id: null,
      new_notes: null,
      new_date: null,
      new_start_time: null,
      new_duration_minutes: null,
    });
  });
});

describe('updateEventSeries', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('maps clearEndsOn onto clear_ends_on, defaulting to false', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });

    await expect(
      updateEventSeries('series-1', { title: 'Renamed' }),
    ).resolves.toEqual({ error: null });
    expect(rpcMock).toHaveBeenCalledWith('update_event_series', {
      target_series: 'series-1',
      new_title: 'Renamed',
      new_venue_id: null,
      new_notes: null,
      new_start_time: null,
      new_duration: null,
      new_table_count: null,
      new_ends_on: null,
      include_overridden: false,
      clear_ends_on: false,
    });
  });

  /*
   * The edit screen (Task 15) sends `clearEndsOn: true` and no `endsOn` for
   * its "Runs indefinitely" toggle — this is the mapping that makes
   * supabase/migrations/20260823080000's `clear_ends_on` argument reachable
   * at all. Pinned here because nothing before this task ever called
   * updateEventSeries with anything other than its defaults.
   */
  it('sends clear_ends_on: true for "runs indefinitely", independent of new_ends_on', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });

    await updateEventSeries('series-1', { clearEndsOn: true });
    expect(rpcMock).toHaveBeenCalledWith('update_event_series', {
      target_series: 'series-1',
      new_title: null,
      new_venue_id: null,
      new_notes: null,
      new_start_time: null,
      new_duration: null,
      new_table_count: null,
      new_ends_on: null,
      include_overridden: false,
      clear_ends_on: true,
    });
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
