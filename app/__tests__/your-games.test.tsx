import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMyUpcomingBookings = vi.fn();
const declineBooking = vi.fn();
const acceptPromotionOffer = vi.fn();
const declinePromotionOffer = vi.fn();
const cancelBooking = vi.fn();

vi.mock('../../lib/bookings', async () => {
  const actual = await vi.importActual<typeof import('../../lib/bookings')>(
    '../../lib/bookings',
  );
  return {
    ...actual,
    fetchMyUpcomingBookings: () => fetchMyUpcomingBookings(),
    declineBooking: (...a: unknown[]) => declineBooking(...a),
    acceptPromotionOffer: (...a: unknown[]) => acceptPromotionOffer(...a),
    declinePromotionOffer: (...a: unknown[]) => declinePromotionOffer(...a),
    cancelBooking: (...a: unknown[]) => cancelBooking(...a),
  };
});

// Copied from app/__tests__/clubs.test.tsx's clubs/session/router mocks.
// The session user id is deliberately 'me' (not clubs.test.tsx's
// 'test-user') so the booking fixtures below can use the literal 'me' for
// "you booked this yourself" without a second layer of id juggling.
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({
    session: { user: { id: 'me' } },
    loading: false,
  }),
}));

const fetchMyClubs = vi.fn();

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchMyClubs: (...args: unknown[]) => fetchMyClubs(...args),
  };
});

import ClubsScreen from '../clubs/index';

const base = {
  booking_id: 'b1',
  group_id: 'g1',
  event_id: 'e1',
  club_id: 'c1',
  club_name: 'Riverside',
  event_title: 'Tuesday game',
  starts_at: '2026-08-25T22:30:00Z',
  club_timezone: 'America/New_York',
  venue_name: "St Mary's Hall",
  event_table_id: 't1',
  table_label: 'Table 2',
  status: 'confirmed' as const,
  booked_by: 'me',
  booked_by_name: 'You',
  offer_id: null,
  offer_seats: null,
  offer_expires_at: null,
};

beforeEach(() => {
  fetchMyUpcomingBookings.mockReset();
  declineBooking.mockReset();
  acceptPromotionOffer.mockReset();
  declinePromotionOffer.mockReset();
  cancelBooking.mockReset();
  fetchMyClubs.mockReset();
  fetchMyUpcomingBookings.mockResolvedValue([]);
  fetchMyClubs.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Your games', () => {
  it('is absent when the member holds no seats', async () => {
    render(<ClubsScreen />);
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalled());
    expect(screen.queryByText('Your games')).toBeNull();
  });

  it('lists a seat with when, where and which table', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([base]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Tuesday game')).toBeTruthy();
    expect(screen.getByText('Table 2')).toBeTruthy();
    expect(screen.getByText("St Mary's Hall")).toBeTruthy();
  });

  it('says who booked a seat for you, and offers a way out', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...base, booked_by: 'p2', booked_by_name: 'Jane P.' },
    ]);
    declineBooking.mockResolvedValue({ error: null });
    render(<ClubsScreen />);
    expect(await screen.findByText('Jane P. booked this for you')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Decline the seat Jane P. booked'));
    await waitFor(() => expect(declineBooking).toHaveBeenCalledWith('b1'));
  });

  it('offers no decline on a seat you booked yourself', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([base]);
    render(<ClubsScreen />);
    await screen.findByText('Tuesday game');
    expect(screen.queryByText(/booked this for you/)).toBeNull();
  });

  it('shows a live offer with its countdown', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      {
        ...base,
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        offer_id: 'o1',
        offer_seats: 2,
        offer_expires_at: '2026-08-24T16:15:00Z',
      },
    ]);
    acceptPromotionOffer.mockResolvedValue({ error: null });
    vi.setSystemTime(new Date('2026-08-24T15:45:00Z'));
    render(<ClubsScreen />);
    expect(await screen.findByText('30 minutes left')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Take the 2 seats'));
    await waitFor(() => expect(acceptPromotionOffer).toHaveBeenCalledWith('o1'));
  });

  it('says where a waitlisted member stands', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      {
        ...base,
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
      },
    ]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Waiting for a seat')).toBeTruthy();
  });

  // The one row action given no test in the original brief: a self-held
  // waitlist spot with no live offer. cancelBooking is in the brief's
  // Consumes list precisely because of this control (see the Task 13
  // report's "Row logic" section), so it gets the same three-part coverage
  // as every other action here — renders, calls the right function with the
  // right id, and does not leak onto a row it should not appear on.
  it('lets a waitlisted member leave the waitlist, and does not offer that on a seated row', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      {
        ...base,
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
      },
    ]);
    cancelBooking.mockResolvedValue({ error: null });
    render(<ClubsScreen />);

    const leaveButton = await screen.findByLabelText(
      'Leave the waitlist for Tuesday game',
    );
    expect(leaveButton).toBeTruthy();

    fireEvent.click(leaveButton);
    await waitFor(() => expect(cancelBooking).toHaveBeenCalledWith('b1'));
  });

  it('does not offer to leave the waitlist on a confirmed, seated row', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([base]);
    render(<ClubsScreen />);
    await screen.findByText('Tuesday game');
    expect(screen.queryByText('Leave the waitlist')).toBeNull();
    expect(
      screen.queryByLabelText('Leave the waitlist for Tuesday game'),
    ).toBeNull();
  });

  it('does not hide the club list when the bookings fetch fails', async () => {
    fetchMyUpcomingBookings.mockResolvedValue(null);
    render(<ClubsScreen />);
    // The clubs are the point of this screen. A failed secondary fetch
    // says so quietly and gets out of the way.
    expect(await screen.findByText('Your clubs')).toBeTruthy();
    expect(screen.getByText('Could not load your games.')).toBeTruthy();
  });
});
