import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NeedsYouStack from '../home/NeedsYouStack';
import { useNeedsYou, type NeedsYou } from '../../lib/use-needs-you';
import type { BookingOutcome, MyBooking } from '../../lib/bookings';
import type { Club } from '../../lib/clubs';
import type { FourthAlert } from '../../lib/dashboard';

const push = vi.fn();
vi.mock('expo-router', () => ({
  useRouter: () => ({ push }),
}));

const fetchMyPendingInvites = vi.fn();
const acceptClubInvite = vi.fn();
const declineClubInvite = vi.fn();
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchMyPendingInvites: (...args: unknown[]) => fetchMyPendingInvites(...args),
    acceptClubInvite: (...args: unknown[]) => acceptClubInvite(...args),
    declineClubInvite: (...args: unknown[]) => declineClubInvite(...args),
  };
});

const fetchUpcomingEvents = vi.fn();
vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchUpcomingEvents: (...args: unknown[]) => fetchUpcomingEvents(...args),
  };
});

const fetchMyUpcomingBookings = vi.fn();
const commitBooking = vi.fn();
const acceptPromotionOffer = vi.fn();
const declineBooking = vi.fn();
vi.mock('../../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bookings')>();
  return {
    ...actual,
    fetchMyUpcomingBookings: (...args: unknown[]) => fetchMyUpcomingBookings(...args),
    commitBooking: (...args: unknown[]) => commitBooking(...args),
    acceptPromotionOffer: (...args: unknown[]) => acceptPromotionOffer(...args),
    declineBooking: (...args: unknown[]) => declineBooking(...args),
  };
});

function needs(over: Partial<NeedsYou> = {}): NeedsYou {
  return {
    clubInvites: [], gameInvites: [], offers: [], alerts: [], busy: false, error: null,
    notice: null, dismissNotice: vi.fn(), acceptClubInvite: vi.fn(), declineClubInvite: vi.fn(),
    acceptGameInvite: vi.fn(), declineGameInvite: vi.fn(), acceptOffer: vi.fn(),
    declineOffer: vi.fn(), takeSeat: vi.fn(), reload: vi.fn(), ...over,
  };
}

describe('NeedsYouStack', () => {
  it('renders nothing when there is nothing to do', () => {
    const { container } = render(<NeedsYouStack needs={needs()} />);
    expect(container.textContent).toBe('');
  });

  it('shows a club invite with Join / No thanks', () => {
    const n = needs({
      clubInvites: [{ id: 'i1', clubId: 'c1', clubName: 'Oakfield', eventId: null, eventTitle: null }],
    });
    render(<NeedsYouStack needs={n} />);
    expect(screen.getByText('Oakfield invited you to join')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join Oakfield' }));
    expect(n.acceptClubInvite).toHaveBeenCalled();
  });

  it('shows a live seat offer with Take the seat', () => {
    const offer = {
      booking_id: 'b1', event_title: 'Thursday', club_name: 'Test Club',
      starts_at: '2026-10-01T15:30:00Z', club_timezone: 'UTC', offer_id: 'o1',
      offer_seats: 1, offer_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    } as unknown as MyBooking;
    const n = needs({ offers: [offer] });
    render(<NeedsYouStack needs={n} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take the 1 seat' }));
    expect(n.acceptOffer).toHaveBeenCalledWith(offer);
  });

  it('shows a need-a-fourth card whose I\'m in takes the seat', () => {
    const alert: FourthAlert = {
      eventId: 'e1', clubId: 'c1', clubName: 'Oakfield', tableId: 't1', text: 'Thu 1 Oct — Club Night',
    };
    const n = needs({ alerts: [alert] });
    render(<NeedsYouStack needs={n} />);
    fireEvent.click(screen.getByRole('button', { name: "I'm in — Thu 1 Oct — Club Night" }));
    expect(n.takeSeat).toHaveBeenCalledWith(alert);
  });

  it('shows the notice with a dismiss, and an error', () => {
    const n = needs({ notice: 'You\'re in — Thursday.', error: 'That game is full.' });
    render(<NeedsYouStack needs={n} />);
    expect(screen.getByText("You're in — Thursday.")).toBeTruthy();
    expect(screen.getByText('That game is full.')).toBeTruthy();
  });
});

const CLUBS = [{ id: 'c1', name: 'Oakfield' }] as unknown as Club[];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useNeedsYou', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMyPendingInvites.mockResolvedValue([]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([]);
  });

  it('does not refetch when the clubs array changes identity but not ids', async () => {
    const { rerender } = renderHook(
      ({ clubs }: { clubs: Club[] }) => useNeedsYou('u1', clubs, vi.fn()),
      { initialProps: { clubs: CLUBS } },
    );
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(1));
    rerender({ clubs: [...CLUBS] });
    rerender({ clubs: [...CLUBS] });
    await act(async () => {});
    expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(1);
    expect(fetchUpcomingEvents).toHaveBeenCalledWith('c1');
  });

  it('surfaces live offers and pending game invites from my bookings', async () => {
    const live = {
      booking_id: 'b1', status: 'waitlisted', offer_id: 'o1', offer_seats: 1,
      offer_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    } as unknown as MyBooking;
    const lapsed = {
      booking_id: 'b2', status: 'waitlisted', offer_id: 'o2', offer_seats: 1,
      offer_expires_at: new Date(Date.now() - 1000).toISOString(),
    } as unknown as MyBooking;
    const invited = {
      booking_id: 'b3', status: 'invited', offer_id: null, offer_seats: null, offer_expires_at: null,
    } as unknown as MyBooking;
    fetchMyUpcomingBookings.mockResolvedValue([live, lapsed, invited]);
    const { result } = renderHook(() => useNeedsYou('u1', CLUBS, vi.fn()));
    await waitFor(() => expect(result.current.offers).toEqual([live]));
    expect(result.current.gameInvites).toEqual([invited]);
  });

  it('takeSeat: a waitlisted outcome says so, naming the game, and survives the clear', async () => {
    const outcome = { outcome: 'waitlisted', waitlist_position: 2 } as BookingOutcome;
    commitBooking.mockResolvedValue({ result: outcome, error: null });
    const onSeatChanged = vi.fn();
    const { result } = renderHook(() => useNeedsYou('u1', CLUBS, onSeatChanged));
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(1));
    const alert: FourthAlert = {
      eventId: 'e1', clubId: 'c1', clubName: 'Oakfield', tableId: 't1', text: 'Thu — Club Night',
    };
    act(() => result.current.takeSeat(alert));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(commitBooking).toHaveBeenCalledWith({
      eventId: 'e1', players: ['u1'], preferredTableId: 't1', allowSplit: false,
    });
    expect(result.current.notice).toBe('2nd on the waitlist — Thu — Club Night');
    expect(onSeatChanged).toHaveBeenCalledTimes(1);
  });

  it('takeSeat: a seated outcome says You\'re in', async () => {
    commitBooking.mockResolvedValue({
      result: { outcome: 'seated', waitlist_position: null } as BookingOutcome,
      error: null,
    });
    const { result } = renderHook(() => useNeedsYou('u1', CLUBS, vi.fn()));
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(1));
    act(() =>
      result.current.takeSeat({
        eventId: 'e1', clubId: 'c1', clubName: 'Oakfield', tableId: 't1', text: 'Thu — Club Night',
      }),
    );
    await waitFor(() => expect(result.current.notice).toBe("You're in — Thu — Club Night."));
  });

  it('ignores a same-tick double tap and holds busy until the reload finishes', async () => {
    const { result } = renderHook(() => useNeedsYou('u1', CLUBS, vi.fn()));
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(1));
    const reloadGate = deferred<MyBooking[]>();
    acceptPromotionOffer.mockResolvedValue({ error: null });
    fetchMyUpcomingBookings.mockReturnValueOnce(reloadGate.promise);
    const offer = { booking_id: 'b1', offer_id: 'o1' } as unknown as MyBooking;
    act(() => {
      result.current.acceptOffer(offer);
      result.current.acceptOffer(offer);
    });
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(2));
    expect(acceptPromotionOffer).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => reloadGate.resolve([]));
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it('shows the refusal verbatim and does not reload or report a seat change', async () => {
    const onSeatChanged = vi.fn();
    const { result } = renderHook(() => useNeedsYou('u1', CLUBS, onSeatChanged));
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(1));
    declineBooking.mockResolvedValue({ error: 'That game has already started.' });
    act(() => result.current.declineGameInvite({ booking_id: 'b3' } as unknown as MyBooking));
    await waitFor(() => expect(result.current.error).toBe('That game has already started.'));
    expect(result.current.busy).toBe(false);
    expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(1);
    expect(onSeatChanged).not.toHaveBeenCalled();
  });

  it('accepting a club invite navigates to the club (or its event)', async () => {
    acceptClubInvite.mockResolvedValue({ clubId: 'c9', eventId: 'e9', error: null });
    const { result } = renderHook(() => useNeedsYou('u1', CLUBS, vi.fn()));
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(1));
    act(() =>
      result.current.acceptClubInvite({
        id: 'i1', clubId: 'c9', clubName: 'Elm', eventId: 'e9', eventTitle: 'Friday',
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/clubs/c9/events/e9'));
  });
});
