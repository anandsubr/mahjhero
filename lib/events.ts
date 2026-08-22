import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

export type EventStatus = 'draft' | 'published' | 'cancelled';
export type SkillTier = 'beginner' | 'intermediate' | 'advanced' | 'mixed';
export type SeriesFrequency = 'weekly' | 'biweekly' | 'monthly_nth_weekday';

/** The field keys `events.overrides` may contain. Mirrors the check constraint. */
export type OverrideKey = 'title' | 'venue_id' | 'notes' | 'starts_at';

export type ClubEvent = {
  id: string;
  club_id: string;
  series_id: string | null;
  title: string;
  venue_id: string;
  venue_name: string;
  notes: string;
  starts_at: string;
  ends_at: string;
  status: EventStatus;
  occurrence_date: string | null;
  overrides: OverrideKey[];
  table_count: number;
};

export type EventTable = {
  id: string;
  label: string;
  skill_tier: SkillTier;
  capacity: number;
  position: number;
};

export type EventSeries = {
  id: string;
  club_id: string;
  title: string;
  venue_id: string;
  notes: string;
  frequency: SeriesFrequency;
  weekday: number;
  nth_week: number | null;
  start_time: string;
  duration_minutes: number;
  table_count: number;
  starts_on: string;
  ends_on: string | null;
  /**
   * The host STOPPED the series, at this instant — distinct from `ends_on`,
   * which is the host's PLAN ("stop repeating after this date"). A series is
   * over iff this is non-null; `ends_on` alone does not mean that yet (the
   * plan may still be in the future, or may never have been reached because
   * the host ended the series early). The edit screen (Task 15) needs both
   * facts, so both are carried here.
   */
  ended_at: string | null;
};

export type RecurrenceRule = {
  frequency: SeriesFrequency;
  /** 0-6, Sunday = 0. Matches `extract(dow ...)` and `Date#getUTCDay()`. */
  weekday: number;
  /** 1-5, or -1 for "last". Null for every frequency but monthly_nth_weekday. */
  nthWeek: number | null;
  /** 'YYYY-MM-DD', a club-local calendar date carrying no instant. */
  startsOn: string;
  /**
   * 'YYYY-MM-DD', inclusive, or null/undefined for "repeats indefinitely".
   * Mirrors `series_occurrence_dates`'s `upper_bound := least(window_end,
   * coalesce(ends_on, window_end))`: a date exactly on `endsOn` is still a
   * valid occurrence, one after it is not. Omitting this from the preview is
   * how the create screen used to promise games the database would never
   * materialize past the host's own stated end date.
   */
  endsOn?: string | null;
};

/**
 * The exact select lists the client relies on, named once so the schema
 * contract test (lib/schema-contract.test.ts) can import them directly
 * rather than retyping them — see lib/profile.ts's PROFILE_COLUMNS for the
 * pattern this follows. A column dropped here without the test noticing is
 * exactly the drift the contract suite exists to catch.
 */
export const EVENT_COLUMNS =
  'id, club_id, series_id, title, venue_id, notes, starts_at, ends_at, ' +
  'status, occurrence_date, overrides, venues(name), event_tables(id)';

export const SERIES_COLUMNS =
  'id, club_id, title, venue_id, notes, frequency, weekday, nth_week, start_time, duration_minutes, table_count, starts_on, ends_on, ended_at';

export const EVENT_TABLE_COLUMNS = 'id, label, skill_tier, capacity, position';

const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const ORDINALS = ['', '1st', '2nd', '3rd', '4th', '5th'];

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

/**
 * Dates are handled entirely in UTC, deliberately.
 *
 * A recurrence rule is a sequence of club-local *calendar dates* and carries
 * no instant at all — the instant is computed in Postgres, from the date plus
 * the club's wall-clock start time, resolved in the club's timezone. Doing
 * the date walk in local time would let the developer's own timezone bend the
 * sequence: `new Date('2027-03-14')` west of Greenwich is the 13th, and a
 * weekly series would silently shift a day for some users and not others.
 */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** The first `weekday` on or after `from`. */
function firstMatch(from: Date, weekday: number): Date {
  return addDays(from, (weekday - from.getUTCDay() + 7) % 7);
}

/** The nth (or last, for -1) `weekday` of the month containing `monthStart`. */
function nthWeekdayOfMonth(
  monthStart: Date,
  weekday: number,
  nthWeek: number,
): Date | null {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));

  if (nthWeek === -1) {
    return addDays(monthEnd, -((monthEnd.getUTCDay() - weekday + 7) % 7));
  }

  const candidate = addDays(firstMatch(monthStart, weekday), 7 * (nthWeek - 1));
  // A month with no fifth Tuesday yields nothing that month, rather than
  // falling back to the fourth. Same rule as series_occurrence_dates.
  return candidate.getUTCMonth() === month ? candidate : null;
}

/**
 * The create screen's preview: the first `count` dates a rule produces.
 *
 * Must agree with `public.series_occurrence_dates` exactly — same weekday
 * encoding, same biweekly anchor, same missing-fifth-weekday rule. A preview
 * that disagrees with what the database will generate is worse than no
 * preview at all.
 */
export function nextOccurrences(rule: RecurrenceRule, count = 3): string[] {
  const start = parseDate(rule.startsOn);
  // `series_occurrence_dates` clamps with
  // `least(window_end, coalesce(ends_on, window_end))` — inclusive of
  // ends_on itself. This preview has no window_end (it just asks for the
  // next `count` dates), so the only clamp that applies here is: stop once a
  // candidate date is past endsOn. A candidate landing exactly on endsOn is
  // still included.
  const endsOn = rule.endsOn ? parseDate(rule.endsOn) : null;
  const out: string[] = [];

  if (rule.frequency === 'weekly' || rule.frequency === 'biweekly') {
    const step = rule.frequency === 'weekly' ? 7 : 14;
    let cursor = firstMatch(start, rule.weekday);
    while (out.length < count) {
      if (endsOn && cursor.getTime() > endsOn.getTime()) break;
      out.push(formatDate(cursor));
      cursor = addDays(cursor, step);
    }
    return out;
  }

  // monthly_nth_weekday. The month cap is a guard against a rule that can
  // never produce anything, not a product limit: a fifth weekday occurs four
  // or five times a year, so three results never need sixty months.
  let month = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  );
  for (let i = 0; i < 60 && out.length < count; i += 1) {
    const candidate = nthWeekdayOfMonth(month, rule.weekday, rule.nthWeek ?? 1);
    if (candidate && candidate.getTime() >= start.getTime()) {
      // Months only increase, so once one candidate lands past endsOn every
      // later one will too — safe to stop rather than skip.
      if (endsOn && candidate.getTime() > endsOn.getTime()) break;
      out.push(formatDate(candidate));
    }
    month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
  }
  return out;
}

/**
 * Renders an instant in the CLUB's timezone, never the device's.
 *
 * A member checking Tuesday's game from a hotel two states over must see the
 * time the game actually starts, in the club's terms. Every date and time
 * this app shows for an event goes through here.
 */
export function formatEventWhen(
  startsAt: string,
  timezone: string,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale ?? 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(new Date(startsAt));
}

/** The rhythm, in words a host would use rather than enum values. */
export function frequencyLabel(
  frequency: SeriesFrequency,
  weekday: number,
  nthWeek: number | null,
): string {
  const day = WEEKDAY_NAMES[weekday] ?? '';
  if (frequency === 'weekly') return `Every ${day}`;
  if (frequency === 'biweekly') return `Every other ${day}`;
  if (nthWeek === -1) return `The last ${day} of the month`;
  return `The ${ORDINALS[nthWeek ?? 1]} ${day} of the month`;
}

// ---------------------------------------------------------------------------
// Data functions
//
// Every function below never rejects. They catch internally, log the original
// cause for diagnosis, and report failure through `{ error }` or a null
// return — the screens await them directly and an escaping rejection would
// strand the member with a spinner and no message.
// ---------------------------------------------------------------------------

type EventRow = Omit<ClubEvent, 'venue_name' | 'table_count'> & {
  venues: { name: string } | null;
  event_tables: { id: string }[] | null;
};

function toClubEvent(row: EventRow): ClubEvent {
  const { venues, event_tables, ...rest } = row;
  return {
    ...rest,
    venue_name: venues?.name ?? '',
    table_count: event_tables?.length ?? 0,
  };
}

export async function fetchUpcomingEvents(
  clubId: string,
): Promise<ClubEvent[] | null> {
  try {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('club_id', clubId)
      .gte('starts_at', new Date().toISOString())
      .order('starts_at');

    if (error) {
      console.error('fetchUpcomingEvents failed', error);
      return null;
    }
    return (data as unknown as EventRow[]).map(toClubEvent);
  } catch (cause) {
    console.error('fetchUpcomingEvents failed', cause);
    return null;
  }
}

export async function fetchEvent(eventId: string): Promise<ClubEvent | null> {
  try {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('id', eventId)
      .single();

    if (error || !data) {
      console.error('fetchEvent failed', error);
      return null;
    }
    return toClubEvent(data as unknown as EventRow);
  } catch (cause) {
    console.error('fetchEvent failed', cause);
    return null;
  }
}

export async function fetchEventTables(
  eventId: string,
): Promise<EventTable[] | null> {
  try {
    const { data, error } = await supabase
      .from('event_tables')
      .select(EVENT_TABLE_COLUMNS)
      .eq('event_id', eventId)
      .order('position');

    if (error) {
      console.error('fetchEventTables failed', error);
      return null;
    }
    return data as EventTable[];
  } catch (cause) {
    console.error('fetchEventTables failed', cause);
    return null;
  }
}

export async function fetchSeries(
  seriesId: string,
): Promise<EventSeries | null> {
  try {
    const { data, error } = await supabase
      .from('event_series')
      .select(SERIES_COLUMNS)
      .eq('id', seriesId)
      .single();

    if (error || !data) {
      console.error('fetchSeries failed', error);
      return null;
    }
    return data as EventSeries;
  } catch (cause) {
    console.error('fetchSeries failed', cause);
    return null;
  }
}

/**
 * The occurrences a host has customised, so the series edit screen can name
 * them in its toggle rather than showing a bare count. Future and live only —
 * cancelled weeks are never touched by a series edit, with or without the
 * toggle, so listing them would misdescribe what the toggle does.
 */
export async function fetchOverriddenOccurrences(
  seriesId: string,
): Promise<ClubEvent[] | null> {
  try {
    const { data, error } = await supabase
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('series_id', seriesId)
      .neq('status', 'cancelled')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at');

    if (error) {
      console.error('fetchOverriddenOccurrences failed', error);
      return null;
    }
    return (data as unknown as EventRow[])
      .map(toClubEvent)
      .filter((e) => e.overrides.length > 0);
  } catch (cause) {
    console.error('fetchOverriddenOccurrences failed', cause);
    return null;
  }
}

/**
 * Club-local calendar values in, an instant computed in Postgres out.
 *
 * `date` and `startTime` are exactly the digits the host picked — a calendar
 * date and a wall-clock time, carrying no instant between them. `create_event`
 * resolves them against `clubs.timezone` with the same
 * `(date + time) at time zone club_tz` expression that materializes a series,
 * so a one-off game and the first week of a series at 7pm land on the same
 * instant. Nothing on this path converts a timezone in JavaScript; that is
 * the point (see supabase/migrations/20260823070000).
 */
export async function createEvent(input: {
  clubId: string;
  title: string;
  venueId: string;
  notes: string;
  /** 'YYYY-MM-DD', club-local. */
  date: string;
  /** 'HH:MM' wall-clock, club-local. */
  startTime: string;
  durationMinutes: number;
  tableCount: number;
}): Promise<{ eventId: string | null; error: string | null }> {
  try {
    if (input.title.trim().length === 0) {
      return { eventId: null, error: 'Give the game a name.' };
    }
    const { data, error } = await supabase.rpc('create_event', {
      target_club: input.clubId,
      event_title: input.title.trim(),
      target_venue: input.venueId,
      event_notes: input.notes.trim(),
      event_date: input.date,
      start_time: input.startTime,
      duration_minutes: input.durationMinutes,
      table_count: input.tableCount,
    });

    if (error || !data) {
      console.error('createEvent failed', error);
      return { eventId: null, error: GENERIC_ERROR };
    }
    return { eventId: data as string, error: null };
  } catch (cause) {
    console.error('createEvent failed', cause);
    return { eventId: null, error: GENERIC_ERROR };
  }
}

/**
 * A null field means "leave this alone", matching the RPC exactly.
 *
 * Calendar values, not instants, for the same reason as `createEvent`: the
 * edit screen must not reintroduce a second client-side implementation of the
 * date-plus-wall-time-in-a-timezone conversion. Passing `date` alone moves the
 * occurrence to another day and keeps its wall-clock time; passing
 * `startTime` or `durationMinutes` alone keeps its day. Leaving all three out
 * leaves the stored instants untouched, exactly as they are.
 */
export async function updateEvent(
  eventId: string,
  input: {
    title?: string | null;
    venueId?: string | null;
    notes?: string | null;
    /** 'YYYY-MM-DD', club-local. */
    date?: string | null;
    /** 'HH:MM' wall-clock, club-local. */
    startTime?: string | null;
    durationMinutes?: number | null;
  },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('update_event', {
      target_event: eventId,
      new_title: input.title ?? null,
      new_venue_id: input.venueId ?? null,
      new_notes: input.notes ?? null,
      new_date: input.date ?? null,
      new_start_time: input.startTime ?? null,
      new_duration_minutes: input.durationMinutes ?? null,
    });

    if (error) {
      console.error('updateEvent failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('updateEvent failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function cancelEvent(
  eventId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('cancel_event', {
      target_event: eventId,
    });
    if (error) {
      console.error('cancelEvent failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('cancelEvent failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/**
 * Resets one occurrence back to whatever its series currently says — title,
 * venue, notes, and instant recomputed from `occurrence_date` plus the
 * series' start time, in the club's timezone, with `overrides` cleared.
 * `reset_event_to_series` itself refuses a cancelled or past occurrence (a
 * host typing values for one specific event is a different act from "give me
 * back whatever the series says today", so update_event carries no such
 * guard, but a reset does).
 */
export async function resetEventToSeries(
  eventId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('reset_event_to_series', {
      target_event: eventId,
    });
    if (error) {
      console.error('resetEventToSeries failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('resetEventToSeries failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/**
 * The number of times `addEventTable` retries after losing the
 * `(event_id, position)` race before giving up.
 */
const ADD_TABLE_MAX_ATTEMPTS = 3;

/**
 * Two concurrent adds can both read the same `max(position)` and then both
 * insert at `next_pos` — the loser hits the `unique (event_id, position)`
 * constraint (`23505`), which is the database catching a genuine race, not a
 * fault to surface to the host as-is. Retried a couple of times (the second
 * attempt reads the position the first attempt's insert left behind, so it
 * essentially always succeeds); only after every attempt collides does this
 * fall back to the generic message. A raw `23505` never reaches the caller.
 */
export async function addEventTable(
  eventId: string,
): Promise<{ error: string | null }> {
  for (let attempt = 1; attempt <= ADD_TABLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { error } = await supabase.rpc('add_event_table', {
        target_event: eventId,
      });
      if (!error) return { error: null };

      if (error.code === '23505' && attempt < ADD_TABLE_MAX_ATTEMPTS) {
        continue;
      }
      console.error('addEventTable failed', error);
      // The table cap (20) is a real answer a host can act on — stop adding
      // tables — not a system fault, so it does not get the generic message.
      // Mirrors createVenue's 23505 mapping in lib/venues.ts.
      if (error.code === '23514') {
        return { error: 'This game already has the maximum of 20 tables.' };
      }
      return { error: GENERIC_ERROR };
    } catch (cause) {
      console.error('addEventTable failed', cause);
      return { error: GENERIC_ERROR };
    }
  }
  return { error: GENERIC_ERROR };
}

export async function updateEventTable(
  tableId: string,
  input: { label?: string | null; tier?: SkillTier | null },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('update_event_table', {
      target_table: tableId,
      new_label: input.label ?? null,
      new_tier: input.tier ?? null,
    });
    if (error) {
      console.error('updateEventTable failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('updateEventTable failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function removeEventTable(
  tableId: string,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('remove_event_table', {
      target_table: tableId,
    });
    if (error) {
      console.error('removeEventTable failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('removeEventTable failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function createEventSeries(input: {
  clubId: string;
  title: string;
  venueId: string;
  notes: string;
  frequency: SeriesFrequency;
  weekday: number;
  nthWeek: number | null;
  startTime: string;
  durationMinutes: number;
  tableCount: number;
  startsOn: string;
  endsOn: string | null;
}): Promise<{ seriesId: string | null; error: string | null }> {
  try {
    if (input.title.trim().length === 0) {
      return { seriesId: null, error: 'Give the game a name.' };
    }
    const { data, error } = await supabase.rpc('create_event_series', {
      target_club: input.clubId,
      series_title: input.title.trim(),
      target_venue: input.venueId,
      series_notes: input.notes.trim(),
      freq: input.frequency,
      weekday: input.weekday,
      nth_week: input.nthWeek,
      start_time: input.startTime,
      duration_minutes: input.durationMinutes,
      table_count: input.tableCount,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
    });

    if (error || !data) {
      console.error('createEventSeries failed', error);
      return { seriesId: null, error: GENERIC_ERROR };
    }
    return { seriesId: data as string, error: null };
  } catch (cause) {
    console.error('createEventSeries failed', cause);
    return { seriesId: null, error: GENERIC_ERROR };
  }
}

export async function updateEventSeries(
  seriesId: string,
  input: {
    title?: string | null;
    venueId?: string | null;
    notes?: string | null;
    startTime?: string | null;
    durationMinutes?: number | null;
    tableCount?: number | null;
    endsOn?: string | null;
    includeOverridden?: boolean;
  },
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('update_event_series', {
      target_series: seriesId,
      new_title: input.title ?? null,
      new_venue_id: input.venueId ?? null,
      new_notes: input.notes ?? null,
      new_start_time: input.startTime ?? null,
      new_duration: input.durationMinutes ?? null,
      new_table_count: input.tableCount ?? null,
      new_ends_on: input.endsOn ?? null,
      include_overridden: input.includeOverridden ?? false,
    });

    if (error) {
      console.error('updateEventSeries failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('updateEventSeries failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function endEventSeries(
  seriesId: string,
  cancelFuture = true,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('end_event_series', {
      target_series: seriesId,
      cancel_future: cancelFuture,
    });
    if (error) {
      console.error('endEventSeries failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('endEventSeries failed', cause);
    return { error: GENERIC_ERROR };
  }
}
