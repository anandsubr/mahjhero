import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1', eventId: 'event-1' };

// This screen's own route, never TabBar's own /clubs -- the Club tab stays
// live here the same way it does on the club detail and venues screens (see
// clubs.test.tsx's and venues.test.tsx's identical comment).
const pathname = '/clubs/club-1/events/event-1';

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
  useLocalSearchParams: () => searchParams,
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render -- see venues.test.tsx's identical
  // comment: `(cb) => cb()` would refire `useUnreadCounts`'s fetch (now
  // pulled in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
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
const placeBooking = vi.fn();
const cancelBooking = vi.fn();
const callForAFourth = vi.fn();

vi.mock('../../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bookings')>();
  return {
    ...actual,
    fetchEventSeating: (...args: unknown[]) => fetchEventSeating(...args),
    fetchOpenOffer: (...args: unknown[]) => fetchOpenOffer(...args),
    placeBooking: (...args: unknown[]) => placeBooking(...args),
    cancelBooking: (...args: unknown[]) => cancelBooking(...args),
    callForAFourth: (...args: unknown[]) => callForAFourth(...args),
  };
});

// Task 12: the event screen's own two additions -- the organizer's door-list
// link and the member's own CheckInControl. `checkInOpen` and `AttendanceState`
// stay real (checkInOpen is pure, and is the exact window rule these tests
// exercise); only the network calls are doubled, same pattern as every other
// lib/* mock in this file.
const fetchMyCheckIn = vi.fn();
const recordAttendance = vi.fn();
const clearAttendance = vi.fn();

vi.mock('../../lib/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/attendance')>();
  return {
    ...actual,
    fetchMyCheckIn: (...args: unknown[]) => fetchMyCheckIn(...args),
    recordAttendance: (...args: unknown[]) => recordAttendance(...args),
    clearAttendance: (...args: unknown[]) => clearAttendance(...args),
  };
});

const fetchTableRounds = vi.fn();
const recordRound = vi.fn();
const deleteRound = vi.fn();

vi.mock('../../lib/rounds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/rounds')>();
  return {
    ...actual,
    fetchTableRounds: (...args: unknown[]) => fetchTableRounds(...args),
    recordRound: (...args: unknown[]) => recordRound(...args),
    deleteRound: (...args: unknown[]) => deleteRound(...args),
  };
});

// TabBar (now carried by this screen) calls `useUnreadCounts`, which reaches
// `fetchUnreadCounts` -- `openThreadForEvent` (used by the "Open the game
// thread" button, never clicked in this file) stays real via the spread.
const fetchUnreadCounts = vi.fn(async () => []);
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: () => fetchUnreadCounts(),
  };
});

// TabBar also now calls useNotificationsUnread for its Alerts badge --
// without this it falls through to a real, unmocked RPC call.
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

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
  check_in_required: false,
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

const SEATED_ADA = {
  booking_id: 'b1',
  group_id: 'g1',
  profile_id: 'test-user',
  display_name: 'Ada',
  skill_level: null,
  event_table_id: 'table-1',
  status: 'confirmed' as const,
  booked_by: 'test-user',
  booked_by_name: 'Ada',
  group_status: 'confirmed' as const,
  waitlist_position: null,
  created_at: '2026-08-20T10:00:00Z',
};

const SEATED_RAVI = {
  ...SEATED_ADA,
  booking_id: 'b2',
  profile_id: 'p1',
  display_name: 'Ravi K.',
  booked_by: 'p1',
  booked_by_name: 'Ravi K.',
};

const ROSTER_WITH_RAVI = [
  ...MEMBER_ROLE,
  { profile_id: 'p1', role: 'member' as const, display_name: 'Ravi K.', skill_level: null },
];

const HOST_ROSTER_WITH_RAVI = [
  ...HOST_ROLE,
  { profile_id: 'p1', role: 'member' as const, display_name: 'Ravi K.', skill_level: null },
];

const ROUND_1 = {
  id: 'r1',
  event_table_id: 'table-1',
  winner_profile_id: 'p1',
  points: 8,
  recorded_by: 'p1',
  created_at: '2026-09-02T20:00:00Z',
};

/**
 * EVENT's own fixture starts in the future (2026-09-03), the "not yet
 * started" case `canBook` already exercises elsewhere in this file. Round
 * recording needs the opposite window -- started, not yet ended -- so this
 * computes it relative to the real clock at test-run time rather than a
 * second hardcoded date that would eventually go stale the same way a
 * fixed past date would.
 */
function liveEvent() {
  return {
    ...EVENT,
    starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  };
}

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
  placeBooking.mockResolvedValue({ error: null });
  cancelBooking.mockResolvedValue({ error: null });
  callForAFourth.mockResolvedValue({ error: null });
  fetchMyCheckIn.mockReset();
  fetchMyCheckIn.mockResolvedValue(null);
  recordAttendance.mockResolvedValue({ error: null });
  clearAttendance.mockResolvedValue({ error: null });
  fetchTableRounds.mockReset();
  fetchTableRounds.mockResolvedValue([]);
  recordRound.mockResolvedValue({ round: null, error: null });
  deleteRound.mockResolvedValue({ error: null });
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

// TabBar navigates with router.replace off an entry route that is itself a
// Redirect, so the history stack is typically one deep -- a state without
// the bar strands a member with no way out but relaunching the app. See
// clubs.test.tsx's and venues.test.tsx's identical rationale.
describe('screen chrome', () => {
  it('carries the tab bar once ready', async () => {
    render(<EventScreen />);
    expect(await screen.findByRole('button', { name: 'Club' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
  });

  it('carries the tab bar while the event is still loading', () => {
    fetchClub.mockReturnValueOnce(new Promise(() => {}));
    fetchEvent.mockReturnValueOnce(new Promise(() => {}));
    render(<EventScreen />);
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  it('carries the tab bar when the event cannot be loaded', async () => {
    fetchEvent.mockResolvedValue(null);
    render(<EventScreen />);
    expect(
      await screen.findByText('That game could not be loaded.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  // This screen's back link now goes to /clubs -- the dashboard, not the
  // specific club -- because the club management page no longer lists
  // games (2026-09-02-club-page-games-and-back-links-design.md): the
  // dashboard is the only real way into this screen left, so that is where
  // back goes. The Club tab reaches the same /clubs route but renders as
  // already-active here, which reads as "you are here" rather than "go
  // back" -- the same reasoning every other back link on this branch
  // documents -- so the explicit link still earns its place.
  it('draws a back link to the dashboard', async () => {
    render(<EventScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to your clubs' }));
    expect(push).toHaveBeenCalledWith('/clubs');
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
    expect(screen.getByText('Advanced')).toBeTruthy();
    // No tier chip buttons -- a member cannot retier a table.
    expect(screen.queryByLabelText('Table 1: Any level')).toBeNull();
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

  // The seat-tap redesign's other half: a plain member's occupied seat is
  // not a button at all (no accessibilityRole, no aria-expanded, no click
  // handler) -- not merely "disabled". A rendered `Pressable` a member's
  // tap silently no-ops would still be a lie about what the seat is; this
  // asserts the control itself doesn't exist for them.
  it('does not let a plain member manage anyone\'s seat', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1]);
    fetchEventSeating.mockResolvedValue([
      {
        booking_id: 'booking-1',
        group_id: 'group-1',
        profile_id: 'p1',
        display_name: 'Ravi K.',
        skill_level: null,
        event_table_id: 'table-1',
        status: 'confirmed' as const,
        booked_by: 'p1',
        booked_by_name: 'Ravi K.',
        group_status: 'confirmed' as const,
        waitlist_position: null,
        created_at: '2026-08-20T10:00:00Z',
      },
    ]);
    render(<EventScreen />);
    expect(await screen.findByText('Ravi K.')).toBeTruthy();
    expect(screen.queryByLabelText("Manage Ravi K.'s seat")).toBeNull();
    expect(screen.queryByText('Move to Table 2')).toBeNull();
    expect(screen.queryByLabelText('Remove Ravi K. from this game')).toBeNull();
    // Nor the member's OWN give-up panel — this seat isn't theirs.
    expect(screen.queryByLabelText('Leave this game')).toBeNull();
  });

  // The gap this fix closes: a member holding a CONFIRMED seat previously
  // had no way to give it up except a host removing them (only a
  // WAITLISTED booking could "Leave the waitlist"). Tapping their own seat
  // now opens the same panel shape a host's own seat gets, but with a
  // single action -- "Leave this game" -- which calls `cancelBooking` on
  // their own booking id via `place_booking`'s sibling, `cancel_booking`.
  it("lets a member give up their own confirmed seat", async () => {
    fetchEventTables.mockResolvedValue([TABLE_1]);
    fetchEventSeating.mockResolvedValue([
      {
        booking_id: 'booking-9',
        group_id: 'group-9',
        profile_id: 'test-user',
        display_name: 'Ada',
        skill_level: null,
        event_table_id: 'table-1',
        status: 'confirmed' as const,
        booked_by: 'test-user',
        booked_by_name: 'Ada',
        group_status: 'confirmed' as const,
        waitlist_position: null,
        created_at: '2026-08-20T10:00:00Z',
      },
    ]);
    render(<EventScreen />);

    expect(
      (await screen.findByLabelText("Manage Ada's seat")).getAttribute(
        'aria-expanded',
      ),
    ).toBe('false');

    fireEvent.click(screen.getByLabelText("Manage Ada's seat"));
    expect(screen.getByLabelText('Leave this game')).toBeTruthy();
    // Not the host's controls -- a plain member's own panel offers no way
    // to move themselves or anyone else, only to leave.
    expect(screen.queryByText(/^Move to /)).toBeNull();
    expect(screen.queryByLabelText('Remove Ada from this game')).toBeNull();

    fireEvent.click(screen.getByLabelText('Leave this game'));
    await vi.waitFor(() =>
      expect(cancelBooking).toHaveBeenCalledWith('booking-9'),
    );
    // Closes the panel and reloads, same as every other booking action on
    // this screen -- a promoted waitlist entry (handled inside
    // `cancel_booking` itself) needs this reload to appear.
    await vi.waitFor(() => expect(fetchEventSeating).toHaveBeenCalledTimes(2));
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

describe('seat management during a live game', () => {
  // Relative to the real clock, matching this file's own convention for
  // any timestamp that needs to stay "in the past"/"in the future" as time
  // moves on (this file installs no fake timers).
  function liveEvent() {
    return {
      ...EVENT,
      starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }

  // `{ ...TABLE_1, capacity: 1 }`, not plain `TABLE_1` -- deliberately, and
  // a deviation from this describe block's original brief. `TABLE_1`'s
  // capacity is 4, and neither booking below is placed AT this table
  // (`event_table_id: null`, or no booking at all), so a plain `TABLE_1`
  // renders FOUR empty seats sharing the identical accessibility label
  // "Take a seat at Table 1" -- SeatGrid renders one `Pressable` per empty
  // seat regardless of whether `onTakeSeat` is supplied, merely toggling
  // `disabled`/`aria-disabled` on it (components/SeatGrid.tsx's own empty-
  // seat block; see also SeatGrid.test.tsx's "offers no empty seat when the
  // table is full", which gets its zero matches from `empties === 0`, not
  // from `onTakeSeat` being absent). `findByLabelText`/`queryByLabelText`
  // throw on multiple matches rather than returning null/one element, so
  // both tests below would error out on that ambiguity regardless of this
  // fix's own correctness. Capacity 1 leaves exactly one empty seat, the
  // same fixture idiom this file already uses at the "hides Call for a 4th
  // now on a capacity-1 table" test above.
  it('lets a member move their own confirmed, unplaced booking once the game has started', async () => {
    fetchEvent.mockResolvedValue(liveEvent());
    fetchEventTables.mockResolvedValue([{ ...TABLE_1, capacity: 1 }]);
    fetchEventSeating.mockResolvedValue([
      {
        booking_id: 'booking-9',
        group_id: 'group-9',
        profile_id: 'test-user',
        display_name: 'Ada',
        skill_level: null,
        event_table_id: null,
        status: 'confirmed' as const,
        booked_by: 'test-user',
        booked_by_name: 'Ada',
        group_status: 'confirmed' as const,
        waitlist_position: null,
        created_at: '2026-08-20T10:00:00Z',
      },
    ]);
    render(<EventScreen />);

    fireEvent.click(await screen.findByLabelText('Take a seat at Table 1'));
    await vi.waitFor(() =>
      expect(placeBooking).toHaveBeenCalledWith('booking-9', 'table-1'),
    );
  });

  // Also a deviation from the brief: `queryByLabelText(...).toBeNull()`
  // cannot pass here, for the same reason documented above -- the empty
  // seat's `Pressable` renders regardless of `onTakeSeat`, so a member with
  // no booking at all still gets a rendered (inert) "Take a seat" control,
  // not an absent one. What actually distinguishes "no seat offered" is the
  // control's own disabled state, the same attribute
  // components/__tests__/SeatGrid.test.tsx already asserts directly
  // ("renders aria-disabled=\"true\" on the empty seat while busy").
  it('still offers no seat at all, for a member with no booking, once the game has started', async () => {
    fetchEvent.mockResolvedValue(liveEvent());
    fetchEventTables.mockResolvedValue([{ ...TABLE_1, capacity: 1 }]);
    fetchEventSeating.mockResolvedValue([]);
    render(<EventScreen />);

    const seat = await screen.findByLabelText('Take a seat at Table 1');
    expect(seat.getAttribute('aria-disabled')).toBe('true');
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

  // This button used to push to a compose screen that emailed the
  // confirmed bookings; it now opens an in-app thread with the "Also email
  // everyone" toggle off by default. "Message everyone booked" was left
  // over from the old behaviour, and an organizer's muscle memory would
  // read it as "this emails everyone booked" — which it no longer does.
  it('offers to open the game thread, not the old email-flavoured label', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(
      await screen.findByRole('button', { name: 'Open the game thread' }),
    ).toBeTruthy();
    expect(screen.queryByText('Message everyone booked')).toBeNull();
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

  // This chip used to be a `Button` with `accessibilityState={{ selected }}`
  // — a prop react-native-web's createDOMProps never forwards to the DOM
  // (see Toggle.tsx's docstring), so a screen reader on web could never
  // tell the current tier from the other three. Task 10's review flagged
  // it and deferred the fix here. Asserts the rendered `aria-selected`
  // attribute itself, not just the click behaviour above, on both the
  // selected chip and an unselected one — a regression back to
  // `accessibilityState` would leave this `null` on both.
  it('marks the table\'s current tier, and only that one, as aria-selected', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');

    expect(screen.getByLabelText('Table 1: Any level').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(
      screen.getByLabelText('Table 1: Advanced').getAttribute('aria-selected'),
    ).toBe('false');
  });

  describe('seat-tap host controls: wired into the event screen', () => {
    const TABLE_2 = {
      id: 'table-2',
      label: 'Table 2',
      skill_tier: 'mixed' as const,
      capacity: 4,
      position: 2,
    };

    const SEATED = {
      booking_id: 'booking-1',
      group_id: 'group-1',
      profile_id: 'p1',
      display_name: 'Ravi K.',
      skill_level: null,
      event_table_id: 'table-1',
      status: 'confirmed' as const,
      booked_by: 'p1',
      booked_by_name: 'Ravi K.',
      group_status: 'confirmed' as const,
      waitlist_position: null,
      created_at: '2026-08-20T10:00:00Z',
    };

    const SEATED_AT_TABLE_2 = {
      ...SEATED,
      booking_id: 'booking-3',
      profile_id: 'p3',
      display_name: 'Priya Nair',
      event_table_id: 'table-2',
      booked_by: 'p3',
      booked_by_name: 'Priya Nair',
    };

    const UNSEATED = {
      ...SEATED,
      booking_id: 'booking-2',
      profile_id: 'p2',
      display_name: 'Mei L.',
      event_table_id: null as string | null,
      booked_by: 'p2',
      booked_by_name: 'Mei L.',
    };

    // Every control on this screen shares one `busy` flag, which a click
    // sets true for the duration of its own request-plus-reload and which
    // a disabled `<button>` genuinely blocks at the DOM level in jsdom
    // (unlike a bare `disabled` style). `fetchEventSeating`'s call count
    // only proves `load()` has STARTED, not that React has committed
    // `busy: false` back to the DOM — so each step below waits on the
    // next control's own `aria-disabled` attribute, the actual precondition
    // for its click to do anything, rather than racing that commit.
    async function waitEnabled(label: string) {
      await vi.waitFor(() =>
        expect(
          screen.getByLabelText(label).getAttribute('aria-disabled'),
        ).not.toBe('true'),
      );
      return screen.getByLabelText(label);
    }

    it('lets the host seat an unplaced booking, move a seated player, and remove them from the game', async () => {
      fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2]);
      fetchEventSeating.mockResolvedValue([SEATED, UNSEATED]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');

      // "Seat Mei L. at Table 1" comes from WaitlistPanel's "Coming, not yet
      // seated" section, unaffected by the seat-tap redesign — Mei has no
      // seat to tap in the first place.
      fireEvent.click(await waitEnabled('Seat Mei L. at Table 1'));
      await vi.waitFor(() =>
        expect(placeBooking).toHaveBeenCalledWith('booking-2', 'table-1'),
      );

      // Ravi K. DOES have a seat, so moving or removing him now goes
      // through the seat grid's own tap panel: "Move to …" / "Remove from
      // game" are not on screen at all until his seat is tapped open. The
      // mocked `fetchEventSeating` never changes what it resolves to, so
      // Ravi still renders seated at Table 1 after each reload below —
      // `hostPlace`/`hostRemove` close whatever panel was open (see
      // index.tsx), so his seat has to be re-opened before each action.
      fireEvent.click(await waitEnabled("Manage Ravi K.'s seat"));
      fireEvent.click(await waitEnabled('Move Ravi K. to Table 2'));
      await vi.waitFor(() =>
        expect(placeBooking).toHaveBeenCalledWith('booking-1', 'table-2'),
      );

      fireEvent.click(await waitEnabled("Manage Ravi K.'s seat"));
      fireEvent.click(await waitEnabled('Remove Ravi K. from this game'));
      await vi.waitFor(() =>
        expect(cancelBooking).toHaveBeenCalledWith('booking-1'),
      );
    });

    it('reveals Move/Remove only after tapping the seat, and hides them again once tapped shut', async () => {
      fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2]);
      fetchEventSeating.mockResolvedValue([SEATED]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');

      expect(screen.queryByText('Move to Table 2')).toBeNull();
      expect(screen.queryByLabelText('Remove Ravi K. from this game')).toBeNull();
      expect(
        screen.getByLabelText("Manage Ravi K.'s seat").getAttribute('aria-expanded'),
      ).toBe('false');

      fireEvent.click(screen.getByLabelText("Manage Ravi K.'s seat"));
      expect(screen.getByLabelText('Move Ravi K. to Table 2')).toBeTruthy();
      expect(screen.getByLabelText('Remove Ravi K. from this game')).toBeTruthy();
      expect(
        screen.getByLabelText("Manage Ravi K.'s seat").getAttribute('aria-expanded'),
      ).toBe('true');

      fireEvent.click(screen.getByLabelText("Manage Ravi K.'s seat"));
      expect(screen.queryByLabelText('Move Ravi K. to Table 2')).toBeNull();
      expect(screen.queryByLabelText('Remove Ravi K. from this game')).toBeNull();
    });

    // The whole-screen version of "only one panel open at a time": Ravi and
    // Priya sit at DIFFERENT tables, each its own SeatGrid instance, so this
    // is the one place that exercises `openBookingId` actually being shared
    // state rather than something each table tracked for itself.
    it('closes one table\'s open seat panel when another table\'s seat is tapped open', async () => {
      fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2]);
      fetchEventSeating.mockResolvedValue([SEATED, SEATED_AT_TABLE_2]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');

      fireEvent.click(screen.getByLabelText("Manage Ravi K.'s seat"));
      expect(screen.getByLabelText('Move Ravi K. to Table 2')).toBeTruthy();

      fireEvent.click(screen.getByLabelText("Manage Priya Nair's seat"));
      expect(screen.queryByLabelText('Move Ravi K. to Table 2')).toBeNull();
      expect(
        screen.getByLabelText("Manage Ravi K.'s seat").getAttribute('aria-expanded'),
      ).toBe('false');
      expect(screen.getByLabelText('Move Priya Nair to Table 1')).toBeTruthy();
      expect(
        screen.getByLabelText("Manage Priya Nair's seat").getAttribute('aria-expanded'),
      ).toBe('true');
    });

    // An organizer is also a member — the empty-seat "book/move yourself"
    // behaviour already treats an organizer's own booking like anyone
    // else's, and this deliberately does the same rather than special-
    // casing "your own seat" as un-tappable. `youId`/`isYou` only ever
    // change the DISPLAYED name ("You" vs. the real one); `seat.name` (the
    // real display name) is what accessibility labels and `onMove`/
    // `onRemove` always use underneath, organizer or not.
    it("lets the host manage their own seat, the same as anybody else's", async () => {
      fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2]);
      fetchEventSeating.mockResolvedValue([
        { ...SEATED, booking_id: 'booking-5', profile_id: 'test-user', display_name: 'Ada' },
      ]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');

      fireEvent.click(await waitEnabled("Manage Ada's seat"));
      expect(screen.getByLabelText('Move Ada to Table 2')).toBeTruthy();

      fireEvent.click(await waitEnabled('Remove Ada from this game'));
      await vi.waitFor(() =>
        expect(cancelBooking).toHaveBeenCalledWith('booking-5'),
      );
    });

    // THE BUG this task fixed: an unplaced booking used to be handed to
    // EVERY table's own HostSeating, so "Mei L." (UNSEATED) appeared once
    // per table card with her own "Seat at {that table}" button each time —
    // reading as "unseated and still at the table" wherever a host could
    // place her. She must now appear exactly once, with one seat option per
    // table gathered into that single row.
    it('lists an unplaced booking once, not once per table, with every table offered from there', async () => {
      fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2]);
      fetchEventSeating.mockResolvedValue([SEATED, UNSEATED]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');

      expect(await screen.findAllByText('Mei L.')).toHaveLength(1);
      expect(screen.getByLabelText('Seat Mei L. at Table 1')).toBeTruthy();
      expect(screen.getByLabelText('Seat Mei L. at Table 2')).toBeTruthy();
    });

    // "Unseat" is gone: a host who wants somebody off a table moves them or
    // removes them from the game, never parks them in limbo on purpose.
    it('offers no "Unseat" control anywhere', async () => {
      fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2]);
      fetchEventSeating.mockResolvedValue([SEATED, UNSEATED]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');
      expect(screen.queryByText('Unseat')).toBeNull();
      expect(screen.queryByLabelText('Unseat Ravi K.')).toBeNull();
    });

    // canCallForAFourth is computed and rendered directly by the screen (no
    // separate component anymore — see index.tsx) — this is the one place
    // that computation is actually exercised.
    // Mirrors need_a_fourth_stage's own occupancy check
    // (20260825050000_need_a_fourth.sql), minus the 48-hour window.
    it('offers "Call for a 4th now" once a table is exactly one player short', async () => {
      fetchEventTables.mockResolvedValue([TABLE_1]);
      fetchEventSeating.mockResolvedValue([
        SEATED,
        { ...SEATED, booking_id: 'booking-3', profile_id: 'p3', display_name: 'Sam T.' },
        { ...SEATED, booking_id: 'booking-4', profile_id: 'p4', display_name: 'Lee C.' },
      ]);
      render(<EventScreen />);
      fireEvent.click(
        await screen.findByLabelText('Call for a fourth at Table 1'),
      );
      await vi.waitFor(() =>
        expect(callForAFourth).toHaveBeenCalledWith('table-1'),
      );
    });

    it('hides "Call for a 4th now" when the table needs more than one more player', async () => {
      fetchEventTables.mockResolvedValue([TABLE_1]);
      fetchEventSeating.mockResolvedValue([SEATED]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');
      expect(
        screen.queryByLabelText('Call for a fourth at Table 1'),
      ).toBeNull();
    });

    // The occupancy count alone is not the whole gate: a table that is one
    // short of a game that has already started must not offer the early
    // call either, matching `canBook`/`need_a_fourth_stage`'s own
    // `e.starts_at <= now()` guard.
    it('hides "Call for a 4th now" on a table that is one short but whose game has already started', async () => {
      fetchEventTables.mockResolvedValue([TABLE_1]);
      fetchEvent.mockResolvedValue({
        ...EVENT,
        starts_at: new Date(Date.now() - 60_000).toISOString(),
      });
      fetchEventSeating.mockResolvedValue([
        SEATED,
        { ...SEATED, booking_id: 'booking-3', profile_id: 'p3', display_name: 'Sam T.' },
        { ...SEATED, booking_id: 'booking-4', profile_id: 'p4', display_name: 'Lee C.' },
      ]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');
      expect(
        screen.queryByLabelText('Call for a fourth at Table 1'),
      ).toBeNull();
    });

    // `needsAFourth` (lib/bookings.ts) and need_a_fourth_stage
    // (20260825050000_need_a_fourth.sql) both open with
    // `if (capacity < 2) return false` / `when t.capacity < 2 then null` --
    // a table that can only ever hold one player can never "need a fourth".
    // The screen's own canCallForAFourth expression must carry the same
    // guard: without it, a capacity-1 table with zero confirmed occupants
    // satisfies `0 === capacity - 1` and would offer a control that
    // call_for_a_fourth's own 23514 check ("table does not need a fourth")
    // can only refuse.
    it('hides "Call for a 4th now" on a capacity-1 table with nobody booked', async () => {
      fetchEventTables.mockResolvedValue([{ ...TABLE_1, capacity: 1 }]);
      fetchEventSeating.mockResolvedValue([]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');
      expect(
        screen.queryByLabelText('Call for a fourth at Table 1'),
      ).toBeNull();
    });
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

  it('shows the edit pencil and offers cancellation', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.getByRole('button', { name: 'Edit Thursday Mahjong' })).toBeTruthy();

    fireEvent.click(screen.getByText('Cancel this game'));
    await vi.waitFor(() => expect(cancelEvent).toHaveBeenCalledWith('event-1'));
  });

  // Nothing asserted this before -- the old plain `Link`'s `href` was never
  // checked, only its visible text.
  it('opens the edit screen when the pencil is pressed', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Thursday Mahjong' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-1/events/event-1/edit');
  });

  it('removes organizer controls once the event reloads as cancelled', async () => {
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');

    fetchEvent.mockResolvedValue({ ...EVENT, status: 'cancelled' as const });
    fireEvent.click(screen.getByText('Cancel this game'));

    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText('Cancel this game')).toBeNull();
    expect(screen.queryByText('Add a table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Thursday Mahjong' })).toBeNull();
  });
});

// Task 12: wiring check-in into the event screen -- an organizer's link to
// the door screen, and a booked member's own CheckInControl. Both gate on
// `event.check_in_required`; the two roles' windows differ (the organizer's
// carries a 24-hour tail past `ends_at`, the member's does not -- see
// lib/attendance.ts's `checkInOpen` and app/clubs/[id]/events/[eventId]/
// check-in.tsx's own doc comment on the organizer tail), so each gets its
// own event fixture below rather than sharing one "inside the window" event.
describe('check-in', () => {
  const CONFIRMED_BOOKING = {
    booking_id: 'booking-1',
    group_id: 'group-1',
    profile_id: 'test-user',
    display_name: 'Ada',
    skill_level: null,
    event_table_id: 'table-1',
    status: 'confirmed' as const,
    booked_by: 'test-user',
    booked_by_name: 'Ada',
    group_status: 'confirmed' as const,
    waitlist_position: null,
    created_at: '2026-08-20T10:00:00Z',
  };

  // starts_at 30 minutes ago, ends_at an hour from now -- inside both the
  // organizer window (starts_at - 1h .. ends_at + 24h) and the member window
  // (starts_at - 1h .. ends_at, no tail) at the moment each test runs.
  const INSIDE_WINDOW_EVENT = {
    ...EVENT,
    check_in_required: true,
    starts_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    ends_at: new Date(Date.now() + 60 * 60_000).toISOString(),
  };

  // starts_at two days out -- opensAt (starts_at - 1h) is still in the
  // future, so both windows read closed regardless of the tail each one
  // carries.
  const OUTSIDE_WINDOW_EVENT = {
    ...EVENT,
    check_in_required: true,
    starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    ends_at: new Date(Date.now() + 2 * 86_400_000 + 3 * 3_600_000).toISOString(),
  };

  describe('the organizer entry point', () => {
    beforeEach(() => {
      fetchRoster.mockResolvedValue(HOST_ROLE);
    });

    it('offers the door list to an organizer when check-in is required', async () => {
      fetchEvent.mockResolvedValue({ ...EVENT, check_in_required: true });
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');
      expect(screen.getByLabelText('Door list')).toBeTruthy();
    });

    it('offers no door list when the event did not ask for check-in', async () => {
      render(<EventScreen />); // base EVENT: check_in_required is false
      await screen.findByText('Thursday Mahjong');
      expect(screen.queryByLabelText('Door list')).toBeNull();
    });

    it('navigates to the door screen', async () => {
      fetchEvent.mockResolvedValue(INSIDE_WINDOW_EVENT);
      render(<EventScreen />);
      fireEvent.click(await screen.findByLabelText('Door list'));
      expect(push).toHaveBeenCalledWith(
        '/clubs/club-1/events/event-1/check-in',
      );
    });

    // Final-review fix (Important 3): event_attendance's reads are
    // deliberately NOT window-bound -- "an organizer can open the list
    // months later and still see the record" (event_attendance's own
    // comment; check-in.tsx:591-602 carries copy for exactly that case).
    // The Door list link is the only in-app route to that read, so it must
    // stay enabled outside the organizer window too, gated on
    // check_in_required alone. The door screen itself still disables its
    // own controls once the window closes -- that assertion lives in
    // check-in.test.tsx, not here.
    it('keeps the door list enabled outside the organizer window -- reads are not window-bound', async () => {
      fetchEvent.mockResolvedValue(OUTSIDE_WINDOW_EVENT);
      render(<EventScreen />);
      const link = await screen.findByLabelText('Door list');
      expect(link.getAttribute('aria-disabled')).not.toBe('true');
      fireEvent.click(link);
      expect(push).toHaveBeenCalledWith(
        '/clubs/club-1/events/event-1/check-in',
      );
    });
  });

  describe("the member's own control", () => {
    it('offers no door list to a plain member', async () => {
      fetchEvent.mockResolvedValue({ ...EVENT, check_in_required: true });
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');
      expect(screen.queryByLabelText('Door list')).toBeNull();
    });

    it('lets a booked member check themselves in inside the window', async () => {
      fetchEvent.mockResolvedValue(INSIDE_WINDOW_EVENT);
      fetchEventSeating.mockResolvedValue([CONFIRMED_BOOKING]);
      render(<EventScreen />);

      const here = await screen.findByLabelText('Here: you');
      fireEvent.click(here);
      await vi.waitFor(() =>
        expect(recordAttendance).toHaveBeenCalledWith({
          eventId: 'event-1',
          profileId: 'test-user',
          state: 'arrived',
        }),
      );
    });

    it('hides the member control outside the window', async () => {
      fetchEvent.mockResolvedValue(OUTSIDE_WINDOW_EVENT);
      fetchEventSeating.mockResolvedValue([CONFIRMED_BOOKING]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');
      expect(screen.queryByLabelText('Here: you')).toBeNull();
    });

    // A waitlisted member has no seat, and `record_attendance` refuses them
    // -- drawing a control guaranteed to fail is worse than drawing none
    // (see lib/attendance.ts's own comment on why this gate exists).
    it('hides the member control for a waitlisted booking', async () => {
      fetchEvent.mockResolvedValue(INSIDE_WINDOW_EVENT);
      fetchEventSeating.mockResolvedValue([
        { ...CONFIRMED_BOOKING, status: 'waitlisted' as const, event_table_id: null },
      ]);
      render(<EventScreen />);
      await screen.findByText('Thursday Mahjong');
      expect(screen.queryByLabelText('Here: you')).toBeNull();
    });
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

describe('table rounds', () => {
  it("shows a table's recorded rounds", async () => {
    fetchRoster.mockResolvedValue(ROSTER_WITH_RAVI);
    fetchEventSeating.mockResolvedValue([SEATED_RAVI]);
    fetchTableRounds.mockResolvedValue([ROUND_1]);

    render(<EventScreen />);

    expect(await screen.findByText('Ravi K. · 8 pts')).toBeTruthy();
  });

  it('lets an organizer record a round while the game is live', async () => {
    // Recording now happens through the seat's own tap panel (SeatGrid,
    // Tasks 3-4), not a picker inside RoundLog (Task 5 removed that
    // entirely) -- so this opens Ravi's seat panel, taps "Record a win",
    // then taps one of the seven fixed point chips, matching how SeatGrid
    // itself is exercised elsewhere in this file (e.g. "Manage Ravi K.'s
    // seat" / "Move Ravi K. to Table 2" above).
    fetchRoster.mockResolvedValue(HOST_ROSTER_WITH_RAVI);
    fetchEvent.mockResolvedValue(liveEvent());
    fetchEventSeating.mockResolvedValue([SEATED_ADA, SEATED_RAVI]);
    fetchTableRounds.mockResolvedValue([]);
    recordRound.mockResolvedValue({ round: ROUND_1, error: null });

    render(<EventScreen />);

    fireEvent.click(await screen.findByLabelText("Manage Ravi K.'s seat"));
    fireEvent.click(screen.getByLabelText('Record a win for Ravi K.'));
    fireEvent.click(
      screen.getByLabelText("Record Ravi K.'s win for 30 points"),
    );

    await waitFor(() =>
      expect(recordRound).toHaveBeenCalledWith({
        tableId: 'table-1',
        winnerProfileId: 'p1',
        points: 30,
      }),
    );
  });

  it('hides the "Record a win" control before the game has started', async () => {
    // EVENT's default fixture starts in the future, so gameLive is false --
    // the same guard assert_round_writable enforces server-side ("this
    // game has not started yet").
    fetchRoster.mockResolvedValue(HOST_ROSTER_WITH_RAVI);
    fetchEventSeating.mockResolvedValue([SEATED_ADA, SEATED_RAVI]);
    fetchTableRounds.mockResolvedValue([]);

    render(<EventScreen />);

    fireEvent.click(await screen.findByLabelText("Manage Ravi K.'s seat"));
    expect(
      screen.queryByLabelText('Record a win for Ravi K.'),
    ).toBeNull();
  });

  it('lets only the organizer delete a round', async () => {
    fetchRoster.mockResolvedValue(ROSTER_WITH_RAVI); // 'member', not organizer
    fetchEventSeating.mockResolvedValue([SEATED_RAVI]);
    fetchTableRounds.mockResolvedValue([ROUND_1]);

    render(<EventScreen />);

    await screen.findByText('Ravi K. · 8 pts');
    expect(
      screen.queryByRole('button', {
        name: "Delete Ravi K.'s round for 8 points",
      }),
    ).toBeNull();
  });
});
