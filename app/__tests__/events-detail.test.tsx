import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1', eventId: 'event-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push }),
  useLocalSearchParams: () => searchParams,
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'test-user' } },
    loading: false,
  }),
);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const fetchClub = vi.fn();
const fetchRoster = vi.fn();

// `canInvite` stays real -- it is pure, and it is the exact host-or-
// co-organizer test this screen is supposed to reuse rather than
// reimplementing its own notion of "organizer".
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchClub: (...args: unknown[]) => fetchClub(...args),
    fetchRoster: (...args: unknown[]) => fetchRoster(...args),
  };
});

const fetchEvent = vi.fn();
const fetchEventTables = vi.fn();
const fetchSeries = vi.fn();
const cancelEvent = vi.fn();
const addEventTable = vi.fn();
const updateEventTable = vi.fn();
const removeEventTable = vi.fn();
const resetEventToSeries = vi.fn();

// formatEventWhen and frequencyLabel stay real, same reasoning as
// clubs.test.tsx and events-new.test.tsx: the whole point of the timezone
// test below is to exercise the real Intl formatting.
vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchEvent: (...args: unknown[]) => fetchEvent(...args),
    fetchEventTables: (...args: unknown[]) => fetchEventTables(...args),
    fetchSeries: (...args: unknown[]) => fetchSeries(...args),
    cancelEvent: (...args: unknown[]) => cancelEvent(...args),
    addEventTable: (...args: unknown[]) => addEventTable(...args),
    updateEventTable: (...args: unknown[]) => updateEventTable(...args),
    removeEventTable: (...args: unknown[]) => removeEventTable(...args),
    resetEventToSeries: (...args: unknown[]) => resetEventToSeries(...args),
  };
});

// Added alongside `fetchOpenOffer` (this fix pass): this file previously left
// `lib/bookings` entirely unmocked, relying on `fetchEventSeating`'s real RPC
// call failing over the test environment's blocked network and resolving
// (via its own try/catch) to `null` fast enough to beat
// `findByText`'s default wait. `fetchOpenOffer` is a second such call, on a
// different code path (`.from().select()` rather than `.rpc()`) that was
// observed to take several seconds to fail closed in this sandbox — long
// enough to blow past that default and fail all 24 tests below with the
// loading spinner still on screen. Mocking both here removes the reliance on
// production network-failure timing entirely, which is what this file should
// have done from the start.
const fetchEventSeating = vi.fn();
const fetchOpenOffer = vi.fn();

vi.mock('../../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bookings')>();
  return {
    ...actual,
    fetchEventSeating: (...args: unknown[]) => fetchEventSeating(...args),
    fetchOpenOffer: (...args: unknown[]) => fetchOpenOffer(...args),
  };
});

import EventScreen from '../clubs/[id]/events/[eventId]/index';

const CLUB = {
  id: 'club-1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private' as const,
  timezone: 'America/New_York',
};

// Deliberately NOT America/New_York, the value `TZ` is pinned to for the
// whole suite (package.json's `test` script). Same technique
// app/__tests__/clubs.test.tsx uses: if the screen ever stopped threading
// `club.timezone` through to `formatEventWhen` and fell back to the
// process/device zone, this event would render in the suite's own
// America/New_York zone instead of Tokyo's -- a different clock hour, and
// for this instant a different calendar day too.
const TOKYO_CLUB = { ...CLUB, timezone: 'Asia/Tokyo' };

const EVENT = {
  id: 'event-1',
  club_id: 'club-1',
  series_id: null as string | null,
  title: 'Thursday Mahjong',
  venue_id: 'venue-1',
  venue_name: 'The Annexe',
  notes: '',
  starts_at: '2026-09-03T13:00:00.000Z',
  ends_at: '2026-09-03T16:00:00.000Z',
  status: 'published' as const,
  occurrence_date: null as string | null,
  overrides: [] as string[],
  table_count: 1,
};

const TABLE_1 = {
  id: 'table-1',
  label: 'Table 1',
  skill_tier: 'mixed' as const,
  capacity: 4,
  position: 1,
};

const MEMBER_ROLE = [
  { profile_id: 'test-user', role: 'member' as const, display_name: 'Ada', skill_level: null },
];
const HOST_ROLE = [
  { profile_id: 'test-user', role: 'host' as const, display_name: 'Ada', skill_level: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.id = 'club-1';
  searchParams.eventId = 'event-1';
  useSessionMock.mockReturnValue({
    session: { user: { id: 'test-user' } },
    loading: false,
  });
  fetchClub.mockResolvedValue(CLUB);
  fetchRoster.mockResolvedValue(MEMBER_ROLE);
  fetchEvent.mockResolvedValue(EVENT);
  fetchEventTables.mockResolvedValue([TABLE_1]);
  fetchSeries.mockResolvedValue(null);
  cancelEvent.mockResolvedValue({ error: null });
  addEventTable.mockResolvedValue({ error: null });
  updateEventTable.mockResolvedValue({ error: null });
  removeEventTable.mockResolvedValue({ error: null });
  resetEventToSeries.mockResolvedValue({ error: null });
  fetchEventSeating.mockReset();
  fetchEventSeating.mockResolvedValue([]);
  fetchOpenOffer.mockReset();
  fetchOpenOffer.mockResolvedValue(null);
});

// A guard-ordering regression this repo has already hit on the club detail
// screen and the create-game screen -- and which this task's own brief
// reintroduced in its sample code, checking `!ready` before `!session`.
// `ready` is only ever set inside an effect gated on a signed-in session, so
// a signed-out visitor can never make it true and would spin forever instead
// of being redirected.
describe('guard ordering', () => {
  it('redirects to sign-in instead of spinning forever when signed out', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<EventScreen />);
    const redirect = await screen.findByTestId('redirect');
    expect(redirect.getAttribute('data-href')).toBe('/sign-in');
    expect(fetchClub).not.toHaveBeenCalled();
  });
});

describe('essential data missing', () => {
  it('shows an error rather than a blank screen when the event fails to load', async () => {
    fetchEvent.mockResolvedValue(null);
    render(<EventScreen />);
    expect(
      await screen.findByText('That game could not be loaded.'),
    ).toBeTruthy();
  });

  it('shows an error rather than a blank screen when the club fails to load', async () => {
    fetchClub.mockResolvedValue(null);
    render(<EventScreen />);
    expect(
      await screen.findByText('That game could not be loaded.'),
    ).toBeTruthy();
  });
});

describe('a section that fails does not blank the rest of the screen', () => {
  it('shows a table-load error while the rest of the page still renders', async () => {
    fetchEventTables.mockResolvedValue(null);
    render(<EventScreen />);
    expect(
      await screen.findByText('Could not load the tables for this game.'),
    ).toBeTruthy();
    // The event itself, loaded independently, is unaffected.
    expect(screen.getByText('Thursday Mahjong')).toBeTruthy();
  });
});

describe('member view: what is shown, and what is not', () => {
  it('renders the event time in the club timezone, not the device/process one', async () => {
    fetchClub.mockResolvedValue(TOKYO_CLUB);
    const { formatEventWhen } = await import('../../lib/events');
    const tokyoWhen = formatEventWhen(EVENT.starts_at, 'Asia/Tokyo');
    const newYorkWhen = formatEventWhen(EVENT.starts_at, 'America/New_York');
    // Guards the fixture itself: if these ever matched, the assertion below
    // would pass regardless of which timezone the screen actually used.
    expect(tokyoWhen).not.toBe(newYorkWhen);

    render(<EventScreen />);
    expect(await screen.findByText(tokyoWhen)).toBeTruthy();
    expect(screen.queryByText(newYorkWhen)).toBeNull();
  });

  // Task 10 replaced this read-only table row with `TableCard`, which
  // reports the seat count as "free", not raw capacity -- and `lib/bookings`
  // is mocked at the top of this file with `fetchEventSeating` resolving an
  // empty array, so nobody is booked and all 4 of this table's seats are
  // free. It resolves rather than rejects deliberately: this file's tests
  // are about the event's own rendering, not about seating, and a
  // `seatingFailed` state would put an unrelated error banner on every one
  // of them.
  it('renders each table with tier as text and seat count, no edit controls', async () => {
    fetchEventTables.mockResolvedValue([
      { id: 'table-1', label: 'Table 1', skill_tier: 'advanced' as const, capacity: 4, position: 1 },
    ]);
    render(<EventScreen />);
    expect(await screen.findByText('Table 1')).toBeTruthy();
    expect(screen.getByText('4 seats free')).toBeTruthy();
    expect(screen.getByText('Advanced')).toBeTruthy();
    // No tier chip buttons -- a member cannot retier a table.
    expect(screen.queryByLabelText('Table 1: Mixed')).toBeNull();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  // The section heading over the table list, which no test reached before
  // Task 17 went looking -- it is also the string e2e/visual.spec.ts anchors
  // its event-detail capture on, so a silent change here would take the
  // baseline's own precondition with it. Two capacities that differ, on
  // purpose: every table in this app is created at the default capacity of 4,
  // so a fixture of 4 + 4 would pass just as happily against
  // `tables.length * 4` as against the real sum.
  it('adds up the seats across tables rather than assuming every table is the same size', async () => {
    fetchEventTables.mockResolvedValue([
      { ...TABLE_1, capacity: 4 },
      { id: 'table-2', label: 'Table 2', skill_tier: 'beginner' as const, capacity: 6, position: 2 },
    ]);
    render(<EventScreen />);
    expect(await screen.findByText('2 tables · 10 seats')).toBeTruthy();
  });

  it('says "1 table", not "1 tables", for a game with one', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1]);
    render(<EventScreen />);
    expect(await screen.findByText('1 table · 4 seats')).toBeTruthy();
  });

  it('offers no organizer controls at all', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText('Add a table')).toBeNull();
    expect(screen.queryByText('Edit this game')).toBeNull();
    expect(screen.queryByText('Cancel this game')).toBeNull();
    expect(screen.queryByText('Reset to the series')).toBeNull();
  });

  // Written when this was the core requirement of the task that shipped
  // this screen: no booking affordance and no "coming soon" badge anywhere,
  // for anyone. Task 10 has since added real booking -- an empty seat's
  // accessibility label reads "Take a seat at …", and a full game offers
  // "Join the waitlist" -- but neither of those, nor anything else on this
  // screen's *initial* render, uses the word "book" (that only appears in
  // the tier-mismatch confirm's "Book anyway?", which needs a tap first).
  // Kept here as a live regression guard against the literal, noisier
  // wording ("Reserve a seat", "Sign up", "Claim a spot") this vocabulary
  // was always meant to keep off the screen. Checked against the screen's
  // full rendered text rather than one specific phrase, so a differently
  // worded control would still be caught.
  it('has no booking affordance and no coming-soon badge anywhere', async () => {
    const { container } = render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    // NOT `container.textContent`: react-native-web renders every <Text> as
    // a separate `<div dir="auto">` with no whitespace between adjacent
    // ones, so plain `.textContent` glues neighbouring labels together
    // ("Thursday Mahjong" + "Book a seat" reads as "...MahjongBook a
    // seat..."). A `\bbook\b` boundary check against that concatenation
    // silently never matches, because there is no non-word character
    // between "Mahjong" and "Book" to anchor the boundary on -- verified by
    // temporarily adding a "Book a seat" button to the screen and watching
    // this assertion still pass against raw textContent. Joining each leaf
    // element's own text with an explicit separator keeps every rendered
    // label distinct, the way a sighted reader (or a screen reader
    // announcing each element) actually encounters them.
    const leaves = Array.from(container.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 0,
    );
    const text = leaves.map((el) => el.textContent).join(' | ');
    expect(text).not.toMatch(/\bbook\b/i);
    expect(text).not.toMatch(/\breserve\b/i);
    expect(text).not.toMatch(/\bclaim\b/i);
    expect(text).not.toMatch(/\bsign up\b/i);
    expect(text).not.toMatch(/coming soon/i);
  });
});

describe('overrides are shown quietly, on the field that changed', () => {
  it('annotates only the fields actually overridden, not every field', async () => {
    fetchEvent.mockResolvedValue({
      ...EVENT,
      series_id: 'series-1',
      overrides: ['venue_id'],
    });
    fetchSeries.mockResolvedValue({
      id: 'series-1',
      club_id: 'club-1',
      title: 'Thursday Mahjong',
      venue_id: 'venue-0',
      notes: '',
      frequency: 'weekly' as const,
      weekday: 4,
      nth_week: null,
      start_time: '19:00',
      duration_minutes: 180,
      table_count: 1,
      starts_on: '2026-01-01',
      ends_on: null,
      ended_at: null,
    });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.getByText('Moved from the usual venue')).toBeTruthy();
    expect(screen.queryByText('Moved from the usual time')).toBeNull();
    expect(screen.queryByText('Renamed for this week')).toBeNull();
    expect(screen.queryByText('Different notes for this week')).toBeNull();
  });

  it('says nothing on an occurrence with no overrides', async () => {
    fetchEvent.mockResolvedValue({ ...EVENT, series_id: 'series-1', overrides: [] });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText('Moved from the usual venue')).toBeNull();
    expect(screen.queryByText('Moved from the usual time')).toBeNull();
    expect(screen.queryByText('Renamed for this week')).toBeNull();
    expect(screen.queryByText('Different notes for this week')).toBeNull();
  });

  it('still explains a week whose notes were customised down to nothing', async () => {
    fetchEvent.mockResolvedValue({
      ...EVENT,
      series_id: 'series-1',
      notes: '',
      overrides: ['notes'],
    });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.getByText('Different notes for this week')).toBeTruthy();
  });
});

describe('organizer view', () => {
  beforeEach(() => {
    fetchRoster.mockResolvedValue(HOST_ROLE);
  });

  it('shows tier chip buttons and retiers a table', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');

    fireEvent.click(screen.getByLabelText('Table 1: Advanced'));
    await vi.waitFor(() =>
      expect(updateEventTable).toHaveBeenCalledWith('table-1', { tier: 'advanced' }),
    );
    // A mutation always reloads, so the retiered table is reflected without
    // a manual refresh.
    await vi.waitFor(() => expect(fetchEventTables).toHaveBeenCalledTimes(2));
  });

  it('adds a table', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    fireEvent.click(screen.getByText('Add a table'));
    await vi.waitFor(() => expect(addEventTable).toHaveBeenCalledWith('event-1'));
  });

  it('surfaces the table-cap message verbatim rather than a generic error', async () => {
    addEventTable.mockResolvedValue({
      error: 'This game already has the maximum of 20 tables.',
    });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    fireEvent.click(screen.getByText('Add a table'));
    expect(
      await screen.findByText('This game already has the maximum of 20 tables.'),
    ).toBeTruthy();
  });

  it('hides Remove on the last remaining table but offers it once there are two', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1]);
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByLabelText('Remove Table 1')).toBeNull();

    fetchEventTables.mockResolvedValue([
      TABLE_1,
      { id: 'table-2', label: 'Table 2', skill_tier: 'mixed' as const, capacity: 4, position: 2 },
    ]);
    fireEvent.click(screen.getByText('Add a table'));

    const removeButton = await screen.findByLabelText('Remove Table 1');
    fireEvent.click(removeButton);
    await vi.waitFor(() => expect(removeEventTable).toHaveBeenCalledWith('table-1'));
  });

  it('shows the edit link and offers cancellation', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.getByText('Edit this game')).toBeTruthy();

    fireEvent.click(screen.getByText('Cancel this game'));
    await vi.waitFor(() => expect(cancelEvent).toHaveBeenCalledWith('event-1'));
  });

  it('removes organizer controls once the event reloads as cancelled', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');

    fetchEvent.mockResolvedValue({ ...EVENT, status: 'cancelled' as const });
    fireEvent.click(screen.getByText('Cancel this game'));

    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText('Cancel this game')).toBeNull();
    expect(screen.queryByText('Add a table')).toBeNull();
    expect(screen.queryByText('Edit this game')).toBeNull();
  });
});

describe('Reset to the series', () => {
  const SERIES = {
    id: 'series-1',
    club_id: 'club-1',
    title: 'Thursday Mahjong',
    venue_id: 'venue-0',
    notes: '',
    frequency: 'weekly' as const,
    weekday: 4,
    nth_week: null,
    start_time: '19:00',
    duration_minutes: 180,
    table_count: 1,
    starts_on: '2026-01-01',
    ends_on: null,
    ended_at: null,
  };

  beforeEach(() => {
    fetchRoster.mockResolvedValue(HOST_ROLE);
    fetchSeries.mockResolvedValue(SERIES);
  });

  // A future instant, computed relative to the real clock rather than a
  // hardcoded date, so this test keeps working regardless of when it runs.
  const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const PAST = new Date(Date.now() - 30 * 86_400_000).toISOString();

  it('is offered on a future, customised series occurrence', async () => {
    fetchEvent.mockResolvedValue({
      ...EVENT,
      series_id: 'series-1',
      starts_at: FUTURE,
      overrides: ['venue_id'],
    });
    render(<EventScreen />);
    const resetButton = await screen.findByText('Reset to the series');
    fireEvent.click(resetButton);
    await vi.waitFor(() => expect(resetEventToSeries).toHaveBeenCalledWith('event-1'));
  });

  it('is hidden on an untouched occurrence (no overrides)', async () => {
    fetchEvent.mockResolvedValue({
      ...EVENT,
      series_id: 'series-1',
      starts_at: FUTURE,
      overrides: [],
    });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText('Reset to the series')).toBeNull();
  });

  it('is hidden on a one-off event even if overrides were somehow set', async () => {
    fetchEvent.mockResolvedValue({
      ...EVENT,
      series_id: null,
      starts_at: FUTURE,
      overrides: ['venue_id'],
    });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText('Reset to the series')).toBeNull();
  });

  it('is hidden on a past occurrence, which the database would refuse to reset', async () => {
    fetchEvent.mockResolvedValue({
      ...EVENT,
      series_id: 'series-1',
      starts_at: PAST,
      overrides: ['venue_id'],
    });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText('Reset to the series')).toBeNull();
  });

  it('is hidden on a cancelled occurrence, which the database would also refuse', async () => {
    fetchEvent.mockResolvedValue({
      ...EVENT,
      series_id: 'series-1',
      starts_at: FUTURE,
      status: 'cancelled' as const,
      overrides: ['venue_id'],
    });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText('Reset to the series')).toBeNull();
  });

  it('is hidden from a plain member even on a customised future occurrence', async () => {
    fetchRoster.mockResolvedValue(MEMBER_ROLE);
    fetchEvent.mockResolvedValue({
      ...EVENT,
      series_id: 'series-1',
      starts_at: FUTURE,
      overrides: ['venue_id'],
    });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText('Reset to the series')).toBeNull();
  });
});
