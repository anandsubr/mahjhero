import { needsAFourth, seatsFreeLabel } from './bookings';
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
  /**
   * Raw enough for `eventStatusLine` to compute from directly — capacity per
   * table and the label a placed seat should show (Task 14). Carried
   * alongside the already-derived `table_count` rather than replacing it;
   * existing callers read `table_count`, only the club list's status line
   * needs the rest.
   */
  event_tables: { id: string; capacity: number; label: string }[];
  /** Every booking row for this event, live and dead. Filter before use. */
  bookings: EventBookingRow[];
  /**
   * Whether this occurrence asked for check-in — added for Task 12, which
   * gates the event screen's door-list link and the member's own
   * `CheckInControl` on it. `lib/bookings.ts`'s `MyBooking` already carried
   * this (Task 9's `my_upcoming_bookings`); `ClubEvent` did not, because
   * nothing read it through `fetchEvent`/`EVENT_COLUMNS` until now.
   */
  check_in_required: boolean;
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
  /**
   * Joined from `venues(name)`, the same embed EVENT_COLUMNS already uses
   * for occurrences (see `toClubEvent`) — added alongside Fix pass 1 on
   * Task 15's review so the edit screen's "The whole series" heading can
   * show the series' OWN venue rather than the occurrence's, which is a
   * different venue whenever `venue_id` is overridden on that occurrence.
   */
  venue_name: string;
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
 *
 * `event_tables(id, capacity, label)` and the top-level `bookings(...)` embed
 * were added for Task 14's "where you stand" line on the club's list.
 * `bookings` is readable by any club member (`bookings_select_club_member`,
 * Task 1), so this is one PostgREST embed, not a second round trip. `label`
 * is not in Task 14's brief text — added anyway, because without it a placed
 * seat's line ("You're in · Table 2") can never actually render; the brief's
 * own `eventStatusLine` signature takes a `tables_labels` map that has to
 * come from somewhere, and `event_tables(id)` alone cannot supply it.
 */
export const EVENT_COLUMNS =
  'id, club_id, series_id, title, venue_id, notes, starts_at, ends_at, ' +
  'status, occurrence_date, overrides, check_in_required, venues(name), ' +
  'event_tables(id, capacity, label), bookings(profile_id, status, event_table_id)';

export const SERIES_COLUMNS =
  'id, club_id, title, venue_id, notes, frequency, weekday, nth_week, start_time, duration_minutes, table_count, starts_on, ends_on, ended_at, venues(name)';

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

/**
 * The wall-clock "HH:MM" an instant reads as in the club's timezone — a
 * READ, not a conversion. The edit screen (Task 15) needs a value to open
 * its TimeField on, and reading one via Intl carries none of the risk the
 * "no client-side timezone conversion" rule guards against, because nothing
 * here builds an instant back out of the parts — calendar values only ever
 * flow INTO the database (see updateEvent/updateEventSeries below); this
 * flows the other way, for display only, exactly like formatEventWhen.
 *
 * `hourCycle: 'h23'` rather than `hour12: false` deliberately — some ICU
 * builds render midnight as "24:00" under `hour12: false`, which
 * TimeField/TIME_PATTERN's 00-23 range would then reject outright.
 */
export function eventStartTimeInZone(startsAt: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).formatToParts(new Date(startsAt));
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour}:${minute}`;
}

/** One booking row as `EVENT_COLUMNS`'s `bookings(...)` embed returns it. */
export type EventBookingRow = {
  profile_id: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled' | 'declined';
  event_table_id: string | null;
};

/**
 * One line per game on the club's list — Task 14.
 *
 * Precedence is deliberate and is NOT alphabetical: YOUR state wins over the
 * club's, because a member already in the game does not need recruiting to
 * it. So: your placed seat, then your "any table" seat, then your waitlist
 * place, then the call for a fourth, then the plain seat count.
 *
 * A waitlisted member's *position* is not in this row's data — `bookings`
 * carries no group, unlike `event_seating`'s RPC. Render `Waiting` here and
 * the position on the event screen, which has the group. Faking a position
 * from this embed, or adding a second round trip just to get one, is
 * exactly what this function must not do.
 *
 * The "one short, within 48 hours" rule is `needsAFourth`'s (lib/bookings.ts)
 * and `need_a_fourth_stage`'s (SQL) alone. This calls `needsAFourth`
 * directly rather than re-deriving the rule inline — Task 12's review already
 * caught a THIRD copy on the event screen that had drifted (it dropped the
 * `capacity < 2` guard the other two carry); a fourth copy here would be the
 * same mistake again.
 *
 * Pure and exported so the branching is testable without rendering — the
 * same reason `resolveIndexRedirect` is (app/index.tsx): the branching IS
 * the behaviour, and a render test hides which branch ran.
 */
export function eventStatusLine(
  event: {
    starts_at: string;
    event_tables: { id: string; capacity: number }[];
    bookings: EventBookingRow[];
    /** Table id -> label, for a placed seat's "· Table 2". */
    tables_labels?: Record<string, string>;
  },
  youId: string,
  now: Date = new Date(),
): string {
  const live = event.bookings.filter(
    (b) => b.status === 'confirmed' || b.status === 'waitlisted',
  );
  const mine = live.find((b) => b.profile_id === youId);

  if (mine?.status === 'confirmed') {
    const label = mine.event_table_id
      ? event.tables_labels?.[mine.event_table_id]
      : null;
    return label ? `You're in · ${label}` : "You're in";
  }
  if (mine?.status === 'waitlisted') return 'Waiting';

  const confirmed = live.filter((b) => b.status === 'confirmed');
  const startsAt = new Date(event.starts_at);
  const oneShortAndSoon = event.event_tables.some((t) =>
    needsAFourth(
      t.capacity,
      confirmed.filter((b) => b.event_table_id === t.id).length,
      startsAt,
      now,
    ),
  );
  if (oneShortAndSoon) return 'Needs a 4th';

  const capacity = event.event_tables.reduce((sum, t) => sum + t.capacity, 0);
  const free = Math.max(0, capacity - confirmed.length);
  // seatsFreeLabel (lib/bookings.ts) owns the "0 seats free" → "Full" rule
  // — shared with TableCard so it cannot drift between the two again.
  return seatsFreeLabel(free);
}

// ---------------------------------------------------------------------------
// Data functions
//
// Every function below never rejects. They catch internally, log the original
// cause for diagnosis, and report failure through `{ error }` or a null
// return — the screens await them directly and an escaping rejection would
// strand the member with a spinner and no message.
// ---------------------------------------------------------------------------

/**
 * The shape of a PostgREST error, loosely — enough to read a code and a
 * message off it without importing supabase-js's own type into every call
 * site, and without asserting a `code` that a thrown non-PostgREST error
 * would not have.
 */
type RpcError = { code?: string | null; message?: string | null } | null | undefined;

/**
 * Rejections the database makes on purpose, and what to tell the host.
 *
 * GENERIC_ERROR says "Could not reach MahjHero. Check your connection and try
 * again." That is a FALSE STATEMENT about a request that reached MahjHero
 * fine and was refused for a reason the host can act on — clearing the title,
 * naming an end date before the start, choosing a date that has already gone
 * past, removing an event's last table. Every one of those used to be
 * reported as a broken internet connection, and the create screen and the
 * edit screen disagreed about the very same rule (create already said "Give
 * the game a name.").
 *
 * Keyed on MESSAGE TEXT ONLY, for the same reason lib/bookings.ts's
 * BOOKING_REFUSALS is: 23514 is the SQLSTATE for every deliberate `raise` in
 * the event functions as well as for a table CHECK violation, so it cannot
 * discriminate an empty title from a past date — and worse, 'no such event'
 * and 'no such table' are raised as P0002 from most of these functions but
 * 42501 from a couple of others (reset_event_to_series, update_event). A
 * vocabulary keyed on code AND message misses every one of those second
 * codes. `codes` below is kept purely as a reader's note of where a message
 * is actually raised from; it is never compared. The strings are the ones
 * the functions raise (supabase/migrations/20260823*, 20260824*, 20260825*)
 * or the constraint name Postgres puts in the message for a CHECK violation
 * (`event_series_ends_after_start`, from 20260822194000). Both are pinned
 * end-to-end against the real database in lib/schema-contract.test.ts, so a
 * renamed constraint or a reworded `raise` turns that suite red rather than
 * silently falling back to the lie.
 *
 * Anything unrecognised still gets GENERIC_ERROR. A vague statement is worse
 * than a precise one and better than a false one.
 */
const RPC_ERROR_MESSAGES: { contains: string; message: string; codes: string[] }[] = [
  {
    contains: 'title is required',
    // Word-for-word what the create screen's own client-side check says, so
    // the two screens stop disagreeing about one rule.
    message: 'Give the game a name.',
    codes: ['23514'],
  },
  {
    contains: 'event_series_ends_after_start',
    message: 'That end date is before the series starts.',
    codes: ['23514'],
  },
  {
    contains: 'that start time has already passed',
    message: 'That start time has already passed. Pick a later one.',
    codes: ['23514'],
  },
  {
    contains: 'no games before that end date',
    // Matches the create screen's own preview copy for the same situation.
    message: 'No games would be created before that end date.',
    codes: ['23514'],
  },
  {
    contains: 'an event must have a date and a start time',
    message: 'Give the game a date and a start time.',
    codes: ['23514'],
  },
  {
    contains: 'duration out of range',
    message: 'Choose a duration between 15 minutes and 24 hours.',
    codes: ['23514'],
  },
  {
    contains: 'table count out of range',
    message: 'Choose between 1 and 20 tables.',
    codes: ['23514'],
  },
  {
    contains: 'an event must end after it starts',
    message: 'The game must end after it starts.',
    codes: ['23514'],
  },
  {
    // Order before 'a cancelled event' -- no, these two strings never
    // collide (see the note below), so order does not matter here.
    contains: "a cancelled event's tables cannot be edited",
    message: 'This game was cancelled and its tables can no longer be edited.',
    codes: ['42501'],
  },
  {
    // Distinct from the entry above -- "…event cannot be edited" is not a
    // substring of "…event's tables cannot be edited", so the two never
    // collide regardless of which is checked first.
    contains: 'a cancelled event cannot be edited',
    message: 'This game was cancelled and can no longer be edited.',
    codes: ['42501'],
  },
  {
    contains: 'this event is not part of a series',
    message: 'This game is not part of a series.',
    codes: ['42501'],
  },
  {
    contains: 'a past occurrence is history and cannot be reset',
    message: 'That date has already passed and cannot be reset.',
    codes: ['42501'],
  },
  {
    contains: 'too many tables',
    message: 'This game already has the maximum of 20 tables.',
    codes: ['23514'],
  },
  {
    contains: 'an event must keep at least one table',
    message: 'A game must keep at least one table.',
    codes: ['23514'],
  },
  {
    contains: 'no such event',
    // Raised as P0002 from cancel_event/add_event_table/reset_event_to_series
    // and 42501 from update_event -- one more reason the code cannot be part
    // of the match.
    message: 'This game is no longer listed.',
    codes: ['P0002', '42501'],
  },
  {
    contains: 'no such table',
    message: 'That table is no longer part of this game.',
    codes: ['P0002'],
  },
  {
    contains: 'no such series',
    message: 'This series is no longer listed.',
    codes: ['P0002'],
  },
  {
    contains: 'venue not available to this club',
    // assert_venue_available, called by create_event/update_event/
    // update_event_series whenever a venue changes.
    message: 'That venue is not available to this club.',
    codes: ['42501'],
  },
  {
    // assert_club_organizer, called first by every one of these functions.
    // A member without the organizer role hitting Cancel, Remove table, or
    // End series used to be told the connection was down.
    contains: 'not an organizer of this club',
    message: 'Only a club organizer can do that.',
    codes: ['42501'],
  },
];

function rpcErrorMessage(error: RpcError): string {
  if (!error) return GENERIC_ERROR;
  const text = error.message ?? '';
  const match = RPC_ERROR_MESSAGES.find((candidate) => text.includes(candidate.contains));
  return match ? match.message : GENERIC_ERROR;
}

type EventRow = Omit<
  ClubEvent,
  'venue_name' | 'table_count' | 'event_tables' | 'bookings'
> & {
  venues: { name: string } | null;
  event_tables: { id: string; capacity: number; label: string }[] | null;
  bookings: EventBookingRow[] | null;
};

function toClubEvent(row: EventRow): ClubEvent {
  const { venues, event_tables, bookings, ...rest } = row;
  return {
    ...rest,
    venue_name: venues?.name ?? '',
    table_count: event_tables?.length ?? 0,
    event_tables: event_tables ?? [],
    bookings: bookings ?? [],
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

type SeriesRow = Omit<EventSeries, 'venue_name'> & {
  venues: { name: string } | null;
};

function toEventSeries(row: SeriesRow): EventSeries {
  const { venues, ...rest } = row;
  return {
    ...rest,
    venue_name: venues?.name ?? '',
  };
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
    return toEventSeries(data as unknown as SeriesRow);
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
 * How many future, non-cancelled occurrences a series still has — the exact
 * set `end_event_series(cancel_future => true)` is about to cancel. The edit
 * screen's "Change the schedule" control (Task 15) uses this so ending a
 * series is a number a host can weigh, not just a warning: "cancels every
 * future game" says nothing about whether that is one game or forty.
 */
export async function fetchFutureOccurrenceCount(
  seriesId: string,
): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('series_id', seriesId)
      .neq('status', 'cancelled')
      .gte('starts_at', new Date().toISOString());

    if (error) {
      console.error('fetchFutureOccurrenceCount failed', error);
      return null;
    }
    return count ?? 0;
  } catch (cause) {
    console.error('fetchFutureOccurrenceCount failed', cause);
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
      return { eventId: null, error: rpcErrorMessage(error) };
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
      return { error: rpcErrorMessage(error) };
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
      return { error: rpcErrorMessage(error) };
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
      return { error: rpcErrorMessage(error) };
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
      // The table cap (20), a cancelled event, or a since-deleted event are
      // all real answers a host can act on — not a system fault — so they go
      // through the same vocabulary every other event mutation uses rather
      // than a one-off special case. A raw 23505 (the race above, exhausted)
      // matches nothing in RPC_ERROR_MESSAGES and still falls back here.
      return { error: rpcErrorMessage(error) };
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
      return { error: rpcErrorMessage(error) };
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
      return { error: rpcErrorMessage(error) };
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
      return { seriesId: null, error: rpcErrorMessage(error) };
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
    /** A club-local calendar date, or null/omitted to leave it alone. */
    endsOn?: string | null;
    /**
     * Un-sets an already-set `ends_on`, so the series runs indefinitely
     * again. `endsOn: null` cannot express this — every other field here
     * follows the same convention, where null means "leave this alone", not
     * "clear it" — so this is a distinct signal. Takes precedence over
     * `endsOn` if a caller somehow sends both (see
     * supabase/migrations/20260823080000).
     */
    clearEndsOn?: boolean;
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
      clear_ends_on: input.clearEndsOn ?? false,
    });

    if (error) {
      console.error('updateEventSeries failed', error);
      return { error: rpcErrorMessage(error) };
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
      return { error: rpcErrorMessage(error) };
    }
    return { error: null };
  } catch (cause) {
    console.error('endEventSeries failed', cause);
    return { error: GENERIC_ERROR };
  }
}
