import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only addEventTable and fetchEvent need a supabase double: every other test
// in this file exercises a pure function. addEventTable's chain is just
// `.rpc(name, args)`. fetchEvent's read path is
// `.from('events').select(EVENT_COLUMNS).eq('id', eventId).single()` — the
// same shape lib/profile.test.ts's `singleAfterSelect` models for its own
// read path.
const rpcMock = vi.fn();
const singleAfterSelect = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ single: singleAfterSelect })),
      })),
    })),
  },
}));

import { GENERIC_ERROR } from './constants';
import {
  addEventTable,
  cancelEvent,
  createEvent,
  createEventSeries,
  endEventSeries,
  eventStartTimeInZone,
  fetchEvent,
  formatEventTime,
  formatEventWhen,
  formatFeeCents,
  frequencyLabel,
  nextOccurrences,
  parseDollarsToCents,
  removeEventTable,
  resetEventToSeries,
  updateEvent,
  updateEventSeries,
  updateEventTable,
} from './events';

/**
 * A minimal, otherwise-valid row shape for the `.single()` response
 * `toClubEvent` maps — every field `fetchEvent` needs present, so a test can
 * vary just the one field it cares about (`event_tables`) without a
 * TypeScript complaint about a missing property.
 */
function eventRow(event_tables: { id: string }[] | null) {
  return {
    id: 'event-1',
    club_id: 'club-1',
    series_id: null,
    title: 'Tuesday Mahjong',
    venue_id: 'venue-1',
    notes: '',
    starts_at: '2027-09-07T23:00:00Z',
    ends_at: '2027-09-08T02:00:00Z',
    status: 'published',
    occurrence_date: null,
    overrides: [],
    venues: { name: 'St Mary’s Hall' },
    event_tables,
  };
}

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

  // Intl.DateTimeFormat.format throws RangeError on an Invalid Date, so a
  // single malformed starts_at from the server used to take down every
  // screen that renders a list of games rather than the one row carrying it.
  it('says so rather than throwing when the date cannot be read', () => {
    expect(formatEventWhen('not-a-date', 'America/New_York')).toBe(
      'Date unavailable',
    );
  });
});

describe('formatEventTime', () => {
  it('renders only the time, in the club timezone', () => {
    const label = formatEventTime('2027-09-08T23:00:00Z', 'America/New_York');
    expect(label).toBe('7:00 pm');
  });

  it('renders the same instant differently in a different timezone', () => {
    const ny = formatEventTime('2027-09-08T23:00:00Z', 'America/New_York');
    const la = formatEventTime('2027-09-08T23:00:00Z', 'America/Los_Angeles');
    expect(ny).not.toBe(la);
  });

  it('degrades to a placeholder on an invalid date rather than throwing', () => {
    expect(formatEventTime('not-a-date', 'America/New_York')).toBe(
      'Time unavailable',
    );
  });
});

describe('formatFeeCents', () => {
  it('formats a whole-dollar amount with no cents', () => {
    expect(formatFeeCents(1500)).toBe('$15');
  });

  it('formats an amount with cents', () => {
    expect(formatFeeCents(1550)).toBe('$15.50');
  });

  it('formats zero', () => {
    expect(formatFeeCents(0)).toBe('$0');
  });
});

describe('parseDollarsToCents', () => {
  it('parses a plain dollar amount', () => {
    expect(parseDollarsToCents('15')).toBe(1500);
  });

  it('parses a dollar amount with cents', () => {
    expect(parseDollarsToCents('15.5')).toBe(1550);
  });

  it('treats a blank string as zero', () => {
    expect(parseDollarsToCents('')).toBe(0);
    expect(parseDollarsToCents('   ')).toBe(0);
  });

  it('treats unparseable text as zero', () => {
    expect(parseDollarsToCents('free')).toBe(0);
  });

  it('clamps a negative amount to zero', () => {
    expect(parseDollarsToCents('-5')).toBe(0);
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

  // Empty rather than a plausible-looking "00:00": this value fills a
  // TimeField, and a midnight the member never chose is a wrong answer they
  // might save over a real one. An empty field is the honest state for a
  // stored value that cannot be read.
  it('returns an empty time rather than throwing when the date cannot be read', () => {
    expect(eventStartTimeInZone('not-a-date', 'America/New_York')).toBe('');
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

describe('fetchEvent (the embedded table_count mapping)', () => {
  // IMPORTANT 2 from Task 17's Fix pass 1 review: mutating toClubEvent's
  // `table_count: event_tables?.length ?? 0` to `table_count: 0` passed all
  // 293 Vitest tests that existed before this block. The club-card test
  // (app/__tests__/clubs.test.tsx) supplies `table_count` directly through a
  // mocked fetchUpcomingEvents, so it covers the screen's rendering, never
  // the mapper that produces the value in the first place. This is the
  // mapper test that closes that gap.
  beforeEach(() => {
    singleAfterSelect.mockReset();
  });

  it('counts the embedded event_tables rows into table_count', async () => {
    singleAfterSelect.mockResolvedValue({
      data: eventRow([{ id: 't1' }, { id: 't2' }, { id: 't3' }]),
      error: null,
    });

    const event = await fetchEvent('event-1');
    expect(event?.table_count).toBe(3);
  });

  it('reports 0 tables when the embed comes back missing, not null/undefined', async () => {
    singleAfterSelect.mockResolvedValue({
      data: eventRow(null),
      error: null,
    });

    const event = await fetchEvent('event-1');
    expect(event?.table_count).toBe(0);
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
    checkInRequired: false,
    feeCents: 0,
    minSpendCents: 0,
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
      check_in: false,
      fee_cents: 0,
      min_spend_cents: 0,
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

  // Task 14: the host's "Require check-in" toggle. `check_in` is
  // `create_event`'s real argument name (supabase/migrations/
  // 20260827010000) — pinned with expect.objectContaining rather than a full
  // object so this test does not have to restate every other argument the
  // test above already pins.
  it('sends check_in on create', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'event-1', error: null });
    await createEvent({ ...validInput, checkInRequired: true });
    expect(rpcMock).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({ check_in: true }),
    );
  });

  it('sends fee_cents and min_spend_cents on create', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'event-1', error: null });
    await createEvent({ ...validInput, feeCents: 1500, minSpendCents: 2000 });
    expect(rpcMock).toHaveBeenCalledWith(
      'create_event',
      expect.objectContaining({ fee_cents: 1500, min_spend_cents: 2000 }),
    );
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
      new_check_in_required: null,
      new_fee_cents: null,
      new_min_spend_cents: null,
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
      new_check_in_required: null,
      new_fee_cents: null,
      new_min_spend_cents: null,
    });
  });

  // Task 14. `new_check_in_required` is `update_event`'s real argument name
  // (supabase/migrations/20260827010000) — distinct from `create_event`'s
  // `check_in`, so this is pinned separately rather than assumed to match.
  it('sends new_check_in_required on update', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    await updateEvent('event-1', { checkInRequired: false });
    expect(rpcMock).toHaveBeenCalledWith(
      'update_event',
      expect.objectContaining({ new_check_in_required: false }),
    );
  });

  it('sends new_fee_cents and new_min_spend_cents on update', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    await updateEvent('event-1', { feeCents: 1500, minSpendCents: 2000 });
    expect(rpcMock).toHaveBeenCalledWith(
      'update_event',
      expect.objectContaining({ new_fee_cents: 1500, new_min_spend_cents: 2000 }),
    );
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
      new_check_in_required: null,
      new_fee_cents: null,
      new_min_spend_cents: null,
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
      new_check_in_required: null,
      new_fee_cents: null,
      new_min_spend_cents: null,
    });
  });

  // Task 14. `new_check_in_required` is `update_event_series`'s real
  // argument name (supabase/migrations/20260827010000) — same name
  // `update_event` uses, unlike the two create functions' `check_in`.
  it('sends new_check_in_required on update series', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    await updateEventSeries('series-1', { checkInRequired: true });
    expect(rpcMock).toHaveBeenCalledWith(
      'update_event_series',
      expect.objectContaining({ new_check_in_required: true }),
    );
  });

  it('sends new_fee_cents and new_min_spend_cents on update series', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    await updateEventSeries('series-1', { feeCents: 1500, minSpendCents: 2000 });
    expect(rpcMock).toHaveBeenCalledWith(
      'update_event_series',
      expect.objectContaining({ new_fee_cents: 1500, new_min_spend_cents: 2000 }),
    );
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
    checkInRequired: false,
    feeCents: 0,
    minSpendCents: 0,
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

  // Task 14. `check_in` is `create_event_series`'s real argument name
  // (supabase/migrations/20260827010000) — same name `create_event` uses,
  // unlike the two update functions' `new_check_in_required`.
  it('sends check_in on create series', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'series-1', error: null });
    await createEventSeries({ ...validInput, checkInRequired: true });
    expect(rpcMock).toHaveBeenCalledWith(
      'create_event_series',
      expect.objectContaining({ check_in: true }),
    );
  });

  it('sends fee_cents and min_spend_cents on create series', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'series-1', error: null });
    await createEventSeries({ ...validInput, feeCents: 1500, minSpendCents: 2000 });
    expect(rpcMock).toHaveBeenCalledWith(
      'create_event_series',
      expect.objectContaining({ fee_cents: 1500, min_spend_cents: 2000 }),
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

/*
 * Deliberate refusals, reported as refusals.
 *
 * Every unmapped error out of these functions became GENERIC_ERROR — "Could
 * not reach MahjHero. Check your connection and try again." — which is a
 * false statement about a request that reached MahjHero and was refused on
 * purpose. Three of them were reachable from the shipped screens: clearing
 * the title on either edit scope, an end date before the series' start, and
 * (since 20260824001000) a date that has already gone by.
 *
 * Each case is asserted against its real payload shape — the message text
 * Postgres actually produces, either from the function's own `raise` or from
 * the constraint name in a CHECK violation. The SQLSTATE in each fixture is
 * deliberately whatever that function really raises it as (see the comment
 * on RPC_ERROR_MESSAGES in lib/events.ts) rather than always the "obvious"
 * code, and the "regardless of SQLSTATE" test below asserts directly that
 * the code plays no part in the match — that was the branch-level bug this
 * vocabulary fixed (BRANCH-LEVEL FINDING, Task 8's report).
 */
describe('deliberate refusals are reported as refusals, not as network failures', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  const pastStart = {
    code: '23514',
    message:
      'that start time has already passed',
  };
  const titleRequired = { code: '23514', message: 'title is required' };
  const endsBeforeStart = {
    code: '23514',
    message:
      'new row for relation "event_series" violates check constraint ' +
      '"event_series_ends_after_start"',
  };
  const noGames = {
    code: '23514',
    message: 'no games before that end date',
  };
  const unknown = { code: '08006', message: 'connection failure' };

  it('createEvent: a past date says so', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: pastStart });
    const result = await createEvent({
      clubId: 'club-1',
      title: 'Tuesday game',
      venueId: 'venue-1',
      notes: '',
      date: '2020-01-01',
      startTime: '19:00',
      durationMinutes: 180,
      tableCount: 1,
      checkInRequired: false,
      feeCents: 0,
      minSpendCents: 0,
    });
    expect(result.error).toBe('That start time has already passed. Pick a later one.');
    expect(result.error).not.toBe(GENERIC_ERROR);
  });

  it('updateEvent: an empty title says the same thing the create screen says', async () => {
    rpcMock.mockResolvedValueOnce({ error: titleRequired });
    // Word-for-word the create screen's own client-side message. The two
    // screens used to disagree about one rule: create said "Give the game a
    // name." and edit said the internet was down.
    await expect(updateEvent('event-1', { title: '  ' })).resolves.toEqual({
      error: 'Give the game a name.',
    });
  });

  it('updateEvent: moving a game into the past says so', async () => {
    rpcMock.mockResolvedValueOnce({ error: pastStart });
    await expect(updateEvent('event-1', { date: '2020-01-01' })).resolves.toEqual({
      error: 'That start time has already passed. Pick a later one.',
    });
  });

  it('updateEventSeries: an empty title says so', async () => {
    rpcMock.mockResolvedValueOnce({ error: titleRequired });
    await expect(updateEventSeries('series-1', { title: '  ' })).resolves.toEqual({
      error: 'Give the game a name.',
    });
  });

  it('updateEventSeries: an end date before the start says so', async () => {
    rpcMock.mockResolvedValueOnce({ error: endsBeforeStart });
    // The message here is the one Postgres writes for a CHECK violation, so
    // the substring being matched is the constraint's own name. Renaming
    // `event_series_ends_after_start` without updating the mapper puts this
    // back to claiming the connection failed — which is why
    // lib/schema-contract.test.ts pins the same pairing against a real
    // database rather than only against this hand-written payload.
    await expect(
      updateEventSeries('series-1', { endsOn: '2020-01-01' }),
    ).resolves.toEqual({ error: 'That end date is before the series starts.' });
  });

  it('createEventSeries: a run that would produce no game says so', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: noGames });
    const result = await createEventSeries({
      clubId: 'club-1',
      title: 'Weekly game',
      venueId: 'venue-1',
      notes: '',
      frequency: 'weekly',
      weekday: 2,
      nthWeek: null,
      startTime: '19:00',
      durationMinutes: 180,
      tableCount: 1,
      startsOn: '2020-01-01',
      endsOn: '2020-01-02',
      checkInRequired: false,
      feeCents: 0,
      minSpendCents: 0,
    });
    // Word-for-word the create screen's own preview copy for the same
    // situation.
    expect(result.error).toBe('No games would be created before that end date.');
  });

  it('createEventSeries: an end date before the start says so', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: endsBeforeStart });
    const result = await createEventSeries({
      clubId: 'club-1',
      title: 'Weekly game',
      venueId: 'venue-1',
      notes: '',
      frequency: 'weekly',
      weekday: 2,
      nthWeek: null,
      startTime: '19:00',
      durationMinutes: 180,
      tableCount: 1,
      startsOn: '2027-06-01',
      endsOn: '2027-01-01',
      checkInRequired: false,
      feeCents: 0,
      minSpendCents: 0,
    });
    expect(result.error).toBe('That end date is before the series starts.');
  });

  it('updateEvent: an out-of-range duration says so, not as an empty title or a past date', async () => {
    // `update_event` raises 23514 for three different reasons (empty title,
    // end-before-start, out-of-range duration); this must not come back
    // borrowing one of the other two sentences.
    rpcMock.mockResolvedValueOnce({
      error: { code: '23514', message: 'duration out of range' },
    });
    await expect(
      updateEvent('event-1', { durationMinutes: 5 }),
    ).resolves.toEqual({
      error: 'Choose a duration between 15 minutes and 24 hours.',
    });
  });

  it('createEvent: no date or start time says so', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: 'an event must have a date and a start time' },
    });
    const result = await createEvent({
      clubId: 'club-1',
      title: 'Tuesday game',
      venueId: 'venue-1',
      notes: '',
      date: '',
      startTime: '',
      durationMinutes: 180,
      tableCount: 1,
      checkInRequired: false,
      feeCents: 0,
      minSpendCents: 0,
    });
    expect(result.error).toBe('Give the game a date and a start time.');
  });

  it('createEvent: a table count out of range says so', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: 'table count out of range' },
    });
    const result = await createEvent({
      clubId: 'club-1',
      title: 'Tuesday game',
      venueId: 'venue-1',
      notes: '',
      date: '2027-01-01',
      startTime: '19:00',
      durationMinutes: 180,
      tableCount: 99,
      checkInRequired: false,
      feeCents: 0,
      minSpendCents: 0,
    });
    expect(result.error).toBe('Choose between 1 and 20 tables.');
  });

  it('updateEvent: a negative fee says so, not that the connection failed', async () => {
    // Task 11's addendum: create_event/update_event/create_event_series/
    // update_event_series now raise 'fee cannot be negative' — pinned here
    // the same way 'duration out of range' is above.
    rpcMock.mockResolvedValueOnce({
      error: { code: '23514', message: 'fee cannot be negative' },
    });
    await expect(
      updateEvent('event-1', { feeCents: -100 }),
    ).resolves.toEqual({
      error: 'The cost to play cannot be negative.',
    });
  });

  it('updateEvent: an end time before the start says so', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: '23514', message: 'an event must end after it starts' },
    });
    await expect(
      updateEvent('event-1', { durationMinutes: 15 }),
    ).resolves.toEqual({ error: 'The game must end after it starts.' });
  });

  it('updateEvent: a cancelled event says it cannot be edited', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: '42501', message: 'a cancelled event cannot be edited' },
    });
    await expect(updateEvent('event-1', { title: 'x' })).resolves.toEqual({
      error: 'This game was cancelled and can no longer be edited.',
    });
  });

  it('an actual connection failure still says the connection failed', async () => {
    rpcMock.mockResolvedValueOnce({ error: unknown });
    await expect(updateEvent('event-1', { title: 'x' })).resolves.toEqual({
      error: GENERIC_ERROR,
    });
  });

  it('an error the vocabulary does not recognise still falls back to the generic message', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: '23514', message: 'zzz not a real refusal' },
    });
    await expect(updateEvent('event-1', { title: 'x' })).resolves.toEqual({
      error: GENERIC_ERROR,
    });
  });

  it('a real refusal message maps regardless of which SQLSTATE accompanies it', async () => {
    // This is the exact defect BRANCH-LEVEL FINDING described: 'no such
    // event' is raised as P0002 from cancel_event/add_event_table but 42501
    // from update_event/reset_event_to_series. A mapper keyed on code AND
    // message would need two entries for the same sentence and would still
    // miss whichever code the reviser did not think of — this one, matched
    // against a code that is not even in RPC_ERROR_MESSAGES's own `codes`
    // list for the entry, proves the code is not part of the match at all.
    rpcMock.mockResolvedValueOnce({
      error: { code: '99999', message: 'no such event' },
    });
    await expect(updateEvent('event-1', { title: 'x' })).resolves.toEqual({
      error: 'This game is no longer listed.',
    });
  });
});

/*
 * cancelEvent, resetEventToSeries, updateEventTable, removeEventTable and
 * endEventSeries used to report EVERY refusal as GENERIC_ERROR unconditionally
 * — they never even called the mapper. An organizer pressing Remove on an
 * event's last table was told to check their connection while the database
 * had refused on purpose. Each now routes through rpcErrorMessage exactly
 * like the functions above.
 */
describe('the table/series mutations report their own refusals', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('cancelEvent: a since-deleted event says so', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: 'P0002', message: 'no such event' },
    });
    await expect(cancelEvent('event-1')).resolves.toEqual({
      error: 'This game is no longer listed.',
    });
  });

  it('cancelEvent: an unrecognised error still falls back', async () => {
    rpcMock.mockResolvedValueOnce({ error: { code: '08006', message: 'connection failure' } });
    await expect(cancelEvent('event-1')).resolves.toEqual({ error: GENERIC_ERROR });
  });

  it('resetEventToSeries: an occurrence with no series says so', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: '42501', message: 'this event is not part of a series' },
    });
    await expect(resetEventToSeries('event-1')).resolves.toEqual({
      error: 'This game is not part of a series.',
    });
  });

  it('resetEventToSeries: a past occurrence says so', async () => {
    rpcMock.mockResolvedValueOnce({
      error: {
        code: '42501',
        message: 'a past occurrence is history and cannot be reset',
      },
    });
    await expect(resetEventToSeries('event-1')).resolves.toEqual({
      error: 'That date has already passed and cannot be reset.',
    });
  });

  it('updateEventTable: a table removed from underneath the host says so', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: 'P0002', message: 'no such table' },
    });
    await expect(updateEventTable('table-1', { label: 'Table 9' })).resolves.toEqual({
      error: 'That table is no longer part of this game.',
    });
  });

  it("removeEventTable: an event's last table says so, not that the connection failed", async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: '23514', message: 'an event must keep at least one table' },
    });
    await expect(removeEventTable('table-1')).resolves.toEqual({
      error: 'A game must keep at least one table.',
    });
  });

  it('removeEventTable: a cancelled event says so', async () => {
    rpcMock.mockResolvedValueOnce({
      error: {
        code: '42501',
        message: "a cancelled event's tables cannot be edited",
      },
    });
    await expect(removeEventTable('table-1')).resolves.toEqual({
      error: 'This game was cancelled and its tables can no longer be edited.',
    });
  });

  it('endEventSeries: a since-deleted series says so', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: 'P0002', message: 'no such series' },
    });
    await expect(endEventSeries('series-1')).resolves.toEqual({
      error: 'This series is no longer listed.',
    });
  });

  it('removeEventTable: a non-organizer says so, not that the connection failed', async () => {
    // assert_club_organizer is the first thing every one of these functions
    // does; a member without the role hitting Remove used to see the
    // generic message too.
    rpcMock.mockResolvedValueOnce({
      error: { code: '42501', message: 'not an organizer of this club' },
    });
    await expect(removeEventTable('table-1')).resolves.toEqual({
      error: 'Only a club organizer can do that.',
    });
  });

  it('updateEvent: a venue the club cannot use says so', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: '42501', message: 'venue not available to this club' },
    });
    await expect(updateEvent('event-1', { venueId: 'venue-9' })).resolves.toEqual({
      error: 'That venue is not available to this club.',
    });
  });
});
