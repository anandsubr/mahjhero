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
    session: { user: { id: 'me' } },
    loading: false,
  }),
);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const fetchClub = vi.fn();
const fetchRoster = vi.fn();

// `canInvite` stays real — the exact host-or-co-organizer test this screen
// reuses rather than reimplementing.
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

// formatEventWhen and frequencyLabel stay real, same reasoning as
// events-detail.test.tsx.
vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchEvent: (...args: unknown[]) => fetchEvent(...args),
    fetchEventTables: (...args: unknown[]) => fetchEventTables(...args),
    fetchSeries: (...args: unknown[]) => fetchSeries(...args),
  };
});

const commitBooking = vi.fn();
const placeBooking = vi.fn();
const cancelBooking = vi.fn();
const fetchEventSeating = vi.fn();
const fetchOpenOffer = vi.fn();
const acceptPromotionOffer = vi.fn();
const declinePromotionOffer = vi.fn();

vi.mock('../../lib/bookings', async () => {
  const actual = await vi.importActual<typeof import('../../lib/bookings')>(
    '../../lib/bookings',
  );
  return {
    ...actual,
    fetchEventSeating: (...a: unknown[]) => fetchEventSeating(...a),
    commitBooking: (...a: unknown[]) => commitBooking(...a),
    placeBooking: (...a: unknown[]) => placeBooking(...a),
    cancelBooking: (...a: unknown[]) => cancelBooking(...a),
    fetchOpenOffer: (...a: unknown[]) => fetchOpenOffer(...a),
    acceptPromotionOffer: (...a: unknown[]) => acceptPromotionOffer(...a),
    declinePromotionOffer: (...a: unknown[]) => declinePromotionOffer(...a),
  };
});

// Task 12 added a `fetchMyCheckIn` call to this screen's own `load()`. Left
// unmocked, it would hit the real `lib/attendance.ts` -> real supabase
// client and fail closed over this sandbox's blocked network, slowly —
// events-detail.test.tsx's own top-of-file comment already records this
// exact trap for fetchEventSeating/fetchOpenOffer. None of this file's
// fixtures set `check_in_required`, so `fetchMyCheckIn` resolving null is
// all any test here needs.
const fetchMyCheckIn = vi.fn();

vi.mock('../../lib/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/attendance')>();
  return {
    ...actual,
    fetchMyCheckIn: (...args: unknown[]) => fetchMyCheckIn(...args),
  };
});

// Task 9 added a `fetchTableRounds` call to this screen's own `load()`. Left
// unmocked, it would hit the real `lib/rounds.ts` -> real supabase client
// and fail closed over this sandbox's blocked network, slowly -- the exact
// same trap `fetchMyCheckIn` above already documents. None of this file's
// tests exercise round recording, so `fetchTableRounds` resolving `[]` is
// all any test here needs.
const fetchTableRounds = vi.fn();

vi.mock('../../lib/rounds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/rounds')>();
  return {
    ...actual,
    fetchTableRounds: (...args: unknown[]) => fetchTableRounds(...args),
  };
});

// TabBar (now carried by this screen) calls `useUnreadCounts`, which reaches
// `fetchUnreadCounts` -- `openThreadForEvent` stays real via the spread (the
// "Open the game thread" button is never clicked in this file).
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

// A future instant, computed relative to the real clock so the "bookable"
// fixture keeps being bookable regardless of when the suite runs.
const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();

const EVENT = {
  id: 'event-1',
  club_id: 'club-1',
  series_id: null as string | null,
  title: 'Thursday Mahjong',
  venue_id: 'venue-1',
  venue_name: 'The Annexe',
  notes: '',
  starts_at: FUTURE,
  ends_at: FUTURE,
  status: 'published' as const,
  occurrence_date: null as string | null,
  overrides: [] as string[],
  table_count: 2,
};

const TABLE_1 = {
  id: 't1',
  label: 'Table 1',
  skill_tier: 'mixed' as const,
  capacity: 4,
  position: 1,
};

const TABLE_2 = {
  id: 't2',
  label: 'Table 2',
  skill_tier: 'advanced' as const,
  capacity: 4,
  position: 2,
};

const MEMBER_ROLE = [
  { profile_id: 'me', role: 'member' as const, display_name: 'Ada', skill_level: 'beginner' as const },
];

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.id = 'club-1';
  searchParams.eventId = 'event-1';
  useSessionMock.mockReturnValue({
    session: { user: { id: 'me' } },
    loading: false,
  });
  fetchClub.mockResolvedValue(CLUB);
  fetchRoster.mockResolvedValue(MEMBER_ROLE);
  fetchEvent.mockResolvedValue(EVENT);
  fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2]);
  fetchSeries.mockResolvedValue(null);
  commitBooking.mockReset();
  placeBooking.mockReset();
  placeBooking.mockResolvedValue({ error: null });
  cancelBooking.mockReset();
  fetchEventSeating.mockReset();
  fetchEventSeating.mockResolvedValue([]);
  fetchOpenOffer.mockReset();
  fetchOpenOffer.mockResolvedValue(null);
  fetchMyCheckIn.mockReset();
  fetchMyCheckIn.mockResolvedValue(null);
  fetchTableRounds.mockReset();
  fetchTableRounds.mockResolvedValue([]);
  acceptPromotionOffer.mockReset();
  acceptPromotionOffer.mockResolvedValue({ error: null });
  declinePromotionOffer.mockReset();
  declinePromotionOffer.mockResolvedValue({ error: null });
});

describe('the event screen, for a member', () => {
  it('books a seat in one tap', async () => {
    commitBooking.mockResolvedValue({
      result: { outcome: 'seated', placements: [] },
      error: null,
    });
    render(<EventScreen />);
    // Table 1 has four seats and nobody in them, so every empty-seat cell
    // carries the same label ("Take a seat at Table 1") — any one of them
    // books the same table, which is all this test cares about.
    const [seat] = await screen.findAllByLabelText('Take a seat at Table 1');
    fireEvent.click(seat);
    await waitFor(() =>
      expect(commitBooking).toHaveBeenCalledWith(
        expect.objectContaining({ preferredTableId: 't1', players: ['me'] }),
      ),
    );
  });

  it('asks first when the table is set up for another tier', async () => {
    // Given a resolved value, not left as the mock's default `undefined` —
    // the brief's own sample RED test omits this, and any implementation
    // that reads the resolved `{ result, error }` (rather than discarding
    // it) throws on an unhandled `undefined` the moment "Yes, book me" is
    // pressed.
    commitBooking.mockResolvedValue({
      result: { outcome: 'seated', placements: [] },
      error: null,
    });
    render(<EventScreen />); // Table 2 is 'advanced'; the member is a beginner
    const [seat] = await screen.findAllByLabelText('Take a seat at Table 2');
    fireEvent.click(seat);
    expect(
      await screen.findByText(
        'Table 2 is set up for advanced players. Book anyway?',
      ),
    ).toBeTruthy();
    expect(commitBooking).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Yes, book me'));
    await waitFor(() => expect(commitBooking).toHaveBeenCalled());
  });

  it('tells the member where they stand when the game is full', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1]);
    fetchEventSeating.mockResolvedValue([
      {
        booking_id: 'b1',
        group_id: 'g1',
        profile_id: 'p1',
        display_name: 'Priya',
        skill_level: null,
        event_table_id: 't1',
        status: 'confirmed' as const,
        booked_by: 'p1',
        booked_by_name: 'Priya',
        group_status: 'confirmed' as const,
        waitlist_position: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        booking_id: 'b2',
        group_id: 'g2',
        profile_id: 'p2',
        display_name: 'Wei',
        skill_level: null,
        event_table_id: 't1',
        status: 'confirmed' as const,
        booked_by: 'p2',
        booked_by_name: 'Wei',
        group_status: 'confirmed' as const,
        waitlist_position: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        booking_id: 'b3',
        group_id: 'g3',
        profile_id: 'p3',
        display_name: 'Sam',
        skill_level: null,
        event_table_id: 't1',
        status: 'confirmed' as const,
        booked_by: 'p3',
        booked_by_name: 'Sam',
        group_status: 'confirmed' as const,
        waitlist_position: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        booking_id: 'b4',
        group_id: 'g4',
        profile_id: 'p4',
        display_name: 'Lee',
        skill_level: null,
        event_table_id: 't1',
        status: 'confirmed' as const,
        booked_by: 'p4',
        booked_by_name: 'Lee',
        group_status: 'confirmed' as const,
        waitlist_position: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    commitBooking.mockResolvedValue({
      result: { outcome: 'waitlisted', waitlist_position: 2, placements: [] },
      error: null,
    });
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Join the waitlist'));
    expect(await screen.findByText('2nd on the waitlist')).toBeTruthy();
  });

  // The refusal the database wrote, not "check your connection". Plan 3
  // shipped the other thing and had to fix it at merge.
  it("shows the database's refusal in the words it wrote", async () => {
    commitBooking.mockResolvedValue({
      result: null,
      error: 'Someone just took the last seat at that table.',
    });
    render(<EventScreen />);
    const [seat] = await screen.findAllByLabelText('Take a seat at Table 1');
    fireEvent.click(seat);
    expect(
      await screen.findByText('Someone just took the last seat at that table.'),
    ).toBeTruthy();
  });

  it('does not read a failed seating fetch as an empty game', async () => {
    fetchEventSeating.mockResolvedValue(null);
    render(<EventScreen />);
    expect(
      await screen.findByText('Could not load who is coming to this game.'),
    ).toBeTruthy();
    expect(screen.queryByText('Nobody has booked yet.')).toBeNull();
  });

  // SeatGrid keeps the empty seat's accessible label even with no
  // `onTakeSeat` — its own test suite renders it that way deliberately
  // (components/__tests__/SeatGrid.test.tsx's "draws every seat the table
  // has, filled and empty" passes no `onTakeSeat` at all and still finds
  // the label once). "No way in" for a cancelled game therefore means the
  // control is genuinely inert — aria-disabled and unresponsive to a
  // click — not that the label vanishes, which SeatGrid's shipped,
  // already-tested contract does not do.
  it('offers a cancelled game no way in', async () => {
    fetchEvent.mockResolvedValue({ ...EVENT, status: 'cancelled' as const });
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    const [seat] = await screen.findAllByLabelText('Take a seat at Table 1');
    expect(seat.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(seat);
    expect(commitBooking).not.toHaveBeenCalled();
  });

  // The offer's `expires_at` is computed relative to the real clock, same
  // reasoning as `FUTURE` above — the countdown text is asserted by pattern
  // rather than an exact value, since the exact minute is a race between
  // this line and the component's own `new Date()` inside `load()`.
  const OFFER = {
    id: 'offer-1',
    group_id: 'g1',
    offered_seat_count: 2,
    expires_at: new Date(Date.now() + 45 * 60_000 + 30_000).toISOString(),
  };

  it('renders the held-offer banner with the seat count and a countdown', async () => {
    fetchOpenOffer.mockResolvedValue(OFFER);
    render(<EventScreen />);
    expect(
      await screen.findByText('2 seats are free for your group'),
    ).toBeTruthy();
    expect(
      screen.getByText(/^\d+ (minute|minutes|hour|hours)( \d+ (minute|minutes))? left$/),
    ).toBeTruthy();
  });

  it('renders no offer banner at all when there is no open offer', async () => {
    fetchOpenOffer.mockResolvedValue(null);
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText(/free for your group/)).toBeNull();
    expect(screen.queryByLabelText('Decline the offer')).toBeNull();
  });

  it('accepts a held offer by its id', async () => {
    fetchOpenOffer.mockResolvedValue(OFFER);
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Take the 2 seats'));
    await waitFor(() =>
      expect(acceptPromotionOffer).toHaveBeenCalledWith('offer-1'),
    );
  });

  it('declines a held offer by its id', async () => {
    fetchOpenOffer.mockResolvedValue(OFFER);
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Decline the offer'));
    await waitFor(() =>
      expect(declinePromotionOffer).toHaveBeenCalledWith('offer-1'),
    );
  });

  // The regression this fix pass exists for. `canBringSomeone` used to also
  // require `!myHoldsSeat`, on the theory that BringSomeoneSheet always
  // re-adds the opener and so an already-seated member would hit a
  // guaranteed "already booked" refusal on every confirm -- but that hid the
  // entry point entirely for what is plausibly the commonest use of the
  // feature ("I'm in, and Jane wants to come too"), with no explanation.
  // BringSomeoneSheet itself now omits the opener when they are already
  // seated (see components/__tests__/BringSomeoneSheet.test.tsx), so the
  // screen no longer needs to hide the button to avoid that refusal.
  //
  // There used to also be a per-table "Bring someone" on every TableCard,
  // and a matching pair of tests here asserting the sheet it opened landed
  // in DOM order right after that table rather than off-screen in the
  // footer. The human decided to remove that entry point entirely (see
  // TableCard's own docstring) -- the sheet already asks "Where?" with
  // every table plus "Any table", so the per-table button only pre-selected
  // a chip the member could change in the next breath, and it vanished
  // table by table as seats filled with no explanation. With only the
  // screen-level button left, there is exactly one entry point and exactly
  // one place the sheet can mount; the tests below cover that directly.
  it('offers exactly one "Bring someone" entry point, not one per table', async () => {
    render(<EventScreen />);
    await screen.findByText('Table 1');
    expect(screen.queryAllByLabelText(/^Bring someone/).length).toBe(1);
  });

  it('opens the sheet with no table pre-selected', async () => {
    render(<EventScreen />);
    fireEvent.click(await screen.findByLabelText('Bring someone'));
    await screen.findByText("Who's coming?");
    expect(screen.getByLabelText('Any table').getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('still offers "Bring someone" to a member who already holds a seat', async () => {
    fetchEventSeating.mockResolvedValue([
      {
        booking_id: 'b1',
        group_id: 'g1',
        profile_id: 'me',
        display_name: 'Ada',
        skill_level: null,
        event_table_id: 't1',
        status: 'confirmed' as const,
        booked_by: 'me',
        booked_by_name: 'Ada',
        group_status: 'confirmed' as const,
        waitlist_position: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    render(<EventScreen />);
    expect(await screen.findByLabelText('Bring someone')).toBeTruthy();
  });
});

// The bug this fix pass exists for: tapping an empty seat while already
// holding a live booking used to route through `commitBooking` regardless —
// the exact RPC `assert_players_bookable` refuses with "already booked" for
// a member who already has one. Every case below routes through
// `placeBooking` (the RPC that already permits moving a member's own
// booking) instead, or offers no tap at all where a move could not
// possibly succeed.
describe('moving a seat once already booked', () => {
  const MY_SEAT_AT_T1 = {
    booking_id: 'my-booking',
    group_id: 'g-me',
    profile_id: 'me',
    display_name: 'Ada',
    skill_level: 'beginner' as const,
    event_table_id: 't1' as string | null,
    status: 'confirmed' as const,
    booked_by: 'me',
    booked_by_name: 'Ada',
    group_status: 'confirmed' as const,
    waitlist_position: null as number | null,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  // Table 2 re-tiered to 'mixed' for the tests that are not themselves
  // about the tier warning — TABLE_2's real fixture is 'advanced' and the
  // member is a 'beginner' (MEMBER_ROLE), which would otherwise interpose
  // the "Book anyway?" confirm these tests are not exercising.
  const TABLE_2_MIXED = { ...TABLE_2, skill_tier: 'mixed' as const };

  it('moves an existing booking, not a second commit, when tapping a seat at another table', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2_MIXED]);
    fetchEventSeating.mockResolvedValue([MY_SEAT_AT_T1]);
    render(<EventScreen />);
    const [seat] = await screen.findAllByLabelText('Take a seat at Table 2');
    fireEvent.click(seat);
    await waitFor(() =>
      expect(placeBooking).toHaveBeenCalledWith('my-booking', 't2'),
    );
    expect(commitBooking).not.toHaveBeenCalled();
  });

  // A callback-only assertion would not prove what actually reached the
  // DOM — SeatGrid's own `disabled` prop is what genuinely blocks a jsdom
  // click, per its docstring, so this asserts the rendered `aria-disabled`
  // the same way events-detail.test.tsx's cancelled-game test does.
  it('offers no action on the seats at the table the member already occupies', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2_MIXED]);
    fetchEventSeating.mockResolvedValue([MY_SEAT_AT_T1]);
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    // Table 1: capacity 4, one seat (the member's own) filled -> three
    // empty cells, all sharing this label.
    const ownTableSeats = await screen.findAllByLabelText(
      'Take a seat at Table 1',
    );
    expect(ownTableSeats.length).toBe(3);
    for (const seat of ownTableSeats) {
      expect(seat.getAttribute('aria-disabled')).toBe('true');
    }
    fireEvent.click(ownTableSeats[0]);
    expect(placeBooking).not.toHaveBeenCalled();
    expect(commitBooking).not.toHaveBeenCalled();

    // Table 2 is a different table, so it stays tappable.
    const otherTableSeats = await screen.findAllByLabelText(
      'Take a seat at Table 2',
    );
    expect(otherTableSeats[0].getAttribute('aria-disabled')).not.toBe('true');
  });

  it('places an "any table" booking at the tapped table', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2_MIXED]);
    fetchEventSeating.mockResolvedValue([
      { ...MY_SEAT_AT_T1, event_table_id: null },
    ]);
    render(<EventScreen />);
    const [seat] = await screen.findAllByLabelText('Take a seat at Table 1');
    fireEvent.click(seat);
    await waitFor(() =>
      expect(placeBooking).toHaveBeenCalledWith('my-booking', 't1'),
    );
    expect(commitBooking).not.toHaveBeenCalled();
  });

  // `place_booking` raises 'booking not confirmed' for a waitlisted one, so
  // no seat anywhere should offer a tap at all.
  it('offers a waitlisted member no tappable seat anywhere', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2_MIXED]);
    fetchEventSeating.mockResolvedValue([
      { ...MY_SEAT_AT_T1, status: 'waitlisted' as const, event_table_id: null },
    ]);
    render(<EventScreen />);
    await screen.findByText('Thursday Mahjong');
    const seats = [
      ...(await screen.findAllByLabelText('Take a seat at Table 1')),
      ...(await screen.findAllByLabelText('Take a seat at Table 2')),
    ];
    expect(seats.length).toBeGreaterThan(0);
    for (const seat of seats) {
      expect(seat.getAttribute('aria-disabled')).toBe('true');
    }
    fireEvent.click(seats[0]);
    expect(placeBooking).not.toHaveBeenCalled();
    expect(commitBooking).not.toHaveBeenCalled();
  });

  // The tier warning applies just as much to a move as to a fresh booking —
  // this reuses TABLE_2's real 'advanced' fixture against the 'beginner'
  // member (MEMBER_ROLE), the same mismatch "asks first when the table is
  // set up for another tier" above exercises for a fresh booking.
  it('still warns before a move to a mismatched table, and moves only on confirm', async () => {
    fetchEventTables.mockResolvedValue([TABLE_1, TABLE_2]);
    fetchEventSeating.mockResolvedValue([MY_SEAT_AT_T1]);
    render(<EventScreen />);
    const [seat] = await screen.findAllByLabelText('Take a seat at Table 2');
    fireEvent.click(seat);
    expect(
      await screen.findByText(
        'Table 2 is set up for advanced players. Book anyway?',
      ),
    ).toBeTruthy();
    expect(placeBooking).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Yes, book me'));
    await waitFor(() =>
      expect(placeBooking).toHaveBeenCalledWith('my-booking', 't2'),
    );
    expect(commitBooking).not.toHaveBeenCalled();
  });
});
