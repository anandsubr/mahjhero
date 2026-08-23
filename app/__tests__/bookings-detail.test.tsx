import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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
const cancelBooking = vi.fn();
const fetchEventSeating = vi.fn();

vi.mock('../../lib/bookings', async () => {
  const actual = await vi.importActual<typeof import('../../lib/bookings')>(
    '../../lib/bookings',
  );
  return {
    ...actual,
    fetchEventSeating: (...a: unknown[]) => fetchEventSeating(...a),
    commitBooking: (...a: unknown[]) => commitBooking(...a),
    cancelBooking: (...a: unknown[]) => cancelBooking(...a),
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
  cancelBooking.mockReset();
  fetchEventSeating.mockReset();
  fetchEventSeating.mockResolvedValue([]);
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
});
