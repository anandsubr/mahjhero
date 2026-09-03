import { useEffect } from 'react';
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

// checkInOpen is left as the real implementation (imported via
// importOriginal) — the same convention events-detail.test.tsx uses — so
// the window-open/closed tests below exercise the real one-hour-lead-free
// comparison, not a stub of it. Only the two writes are doubled.
const recordAttendance = vi.fn();
const clearAttendance = vi.fn();

vi.mock('../../lib/attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/attendance')>();
  return {
    ...actual,
    recordAttendance: (...a: unknown[]) => recordAttendance(...a),
    clearAttendance: (...a: unknown[]) => clearAttendance(...a),
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
  // TabBar's own Club tab route: ClubsScreen here IS /clubs, so its
  // highlighted Club button stays the documented no-op.
  usePathname: () => '/clubs',
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire `useUnreadCounts`'s
  // fetch (now pulled in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// Module-scoped constant, not a fresh object per render: TabBar's badge now
// reads `useSession` too (via `useUnreadCounts`), and a fresh object here
// breaks the referential stability its `useCallback([session])` depends on,
// refiring the fetch on every render.
const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

// TabBar (carried by ClubsScreen, which this file renders) now calls
// `useUnreadCounts`, which reaches `fetchUnreadCounts`.
// Spread `actual` rather than replacing the module outright: TabBar (carried
// by this screen) now also calls `unreadSuffix`, a pure helper covered by
// lib/messages.test.ts -- only `fetchUnreadCounts` needs to be a
// controllable double here.
vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: vi.fn(async () => []),
  };
});

// TabBar also now calls useNotificationsUnread for its Alerts badge --
// without this it falls through to a real, unmocked RPC call.
vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
}));

const fetchMyClubs = vi.fn();

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchMyClubs: (...args: unknown[]) => fetchMyClubs(...args),
  };
});

const fetchUpcomingEvents = vi.fn();

// Needed only because this file now seeds a club (see `beforeEach`): the
// dashboard reads the open games of every club the member is in, so with an
// empty club list it issued no read at all and none of these tests noticed.
// One club means one read, and unmocked it would go to the real Supabase call
// against the placeholder env. Partial mock so `formatEventWhen` stays real —
// the rows below assert the strings it actually produces.
vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchUpcomingEvents: (...args: unknown[]) => fetchUpcomingEvents(...args),
  };
});

const fetchProfile = vi.fn();

// The dashboard reads the member's display name for the header avatar. With
// lib/profile left unmocked, every test in this file fired a real request at
// the placeholder Supabase env — caught and swallowed by `fetchProfile`, so
// nothing failed, but a unit test has no business on the network. Same
// partial-mock shape as the modules above, and exactly ONE `vi.mock` for this
// specifier: two are both hoisted and only one survives.
vi.mock('../../lib/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/profile')>();
  return { ...actual, fetchProfile: (...args: unknown[]) => fetchProfile(...args) };
});

import ClubsScreen from '../clubs/index';
import type { MyBooking } from '../../lib/bookings';

const base: MyBooking = {
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
  status: 'confirmed',
  booked_by: 'me',
  booked_by_name: 'You',
  offer_id: null,
  offer_seats: null,
  offer_expires_at: null,
  waitlist_position: null,
  // The four check-in fields (Task 8/9) default to "this event never asked
  // for check-in" — most of the tests below have nothing to do with
  // check-in and should not have to know these fields exist.
  check_in_required: false,
  check_in_state: null,
  check_in_opens_at: null,
  check_in_closes_at: null,
};

// The club every fixture booking above belongs to. This file used to seed
// no clubs at all, which was never coherent — a booking is a seat at a club's
// event, so a member holding one is in that club — and stopped working once
// the dashboard gave a member in no clubs an early return of their own: the
// "Your games" section this whole file is about is not drawn for someone with
// nowhere to play.
const CLUB = {
  id: base.club_id,
  name: base.club_name,
  slug: 'riverside',
  rhythm: 'Tuesday evenings',
  visibility: 'private' as const,
  timezone: base.club_timezone,
};

// A `booking()` helper, not four fields repeated per test: every fixture
// in this file goes through this rather than spreading `base` inline, so
// adding a field here (as the check-in fields just were) does not require
// touching every existing test.
function booking(overrides: Partial<MyBooking> = {}): MyBooking {
  return { ...base, ...overrides };
}

beforeEach(() => {
  fetchMyUpcomingBookings.mockReset();
  declineBooking.mockReset();
  acceptPromotionOffer.mockReset();
  declinePromotionOffer.mockReset();
  cancelBooking.mockReset();
  recordAttendance.mockReset();
  clearAttendance.mockReset();
  fetchMyClubs.mockReset();
  fetchUpcomingEvents.mockReset();
  fetchProfile.mockReset();
  fetchMyUpcomingBookings.mockResolvedValue([]);
  fetchMyClubs.mockResolvedValue([CLUB]);
  // No open games beyond whatever the bookings themselves describe: this
  // file is about the seats a member holds, not the ones they could still
  // join.
  fetchUpcomingEvents.mockResolvedValue([]);
  // No display name set, which is what the header's avatar falls back to a
  // person glyph for — the state every test here was already implicitly in
  // when the real call failed.
  fetchProfile.mockResolvedValue(null);
  recordAttendance.mockResolvedValue({ error: null });
  clearAttendance.mockResolvedValue({ error: null });
  // Every fixture's `starts_at` is a fixed calendar timestamp
  // ('2026-08-25T22:30:00Z') chosen so `formatEventWhen` produces stable,
  // assertable strings. The new "hide seat-management once started" gate
  // (Step 3) compares that fixed timestamp against `Date.now()` — left
  // un-pinned, this whole file would start failing the moment the real
  // clock crosses 2026-08-25T22:30:00Z, and would do so forever after.
  // Freezing "now" well before that instant makes every existing row's
  // "not started yet" assertions time-independent; tests that care about a
  // different instant (the live-offer countdown, the new gate tests below)
  // call `vi.setSystemTime` again themselves, which overrides this.
  vi.setSystemTime(new Date('2026-08-25T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Your games', () => {
  // The "Your games" title itself is gone (2026-09-01-ui-tweaks-design.md,
  // item 6) — the header above it already names the scope ("Your clubs" or
  // a specific club), so a repeated "games" label added nothing. What must
  // still be absent when the member holds no seats is a *row*, not a
  // heading — this describe block is named for the section, not for text
  // it asserts on.
  it('offers the empty state, not a row, when the member holds no seats', async () => {
    render(<ClubsScreen />);
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalled());
    expect(await screen.findByText('Nothing else coming up.')).toBeTruthy();
    expect(screen.queryByText('Tuesday game')).toBeNull();
  });

  it('lists a seat with when, where and which table', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([booking()]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Tuesday game')).toBeTruthy();
    expect(screen.getByText('Table 2')).toBeTruthy();
    // Task 8's row puts the formatted time and the venue on one meta line
    // separated by a middle dot, so the venue is no longer an element of its
    // own and an exact-string query cannot find it.
    expect(screen.getByText(/St Mary's Hall/)).toBeTruthy();
  });

  it('says who booked a seat for you, and offers a way out', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({ booked_by: 'p2', booked_by_name: 'Jane P.' }),
    ]);
    declineBooking.mockResolvedValue({ error: null });
    render(<ClubsScreen />);
    expect(await screen.findByText('Jane P. booked this for you')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Decline the seat Jane P. booked'));
    await waitFor(() => expect(declineBooking).toHaveBeenCalledWith('b1'));
  });

  it('offers no decline on a seat you booked yourself', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([booking()]);
    render(<ClubsScreen />);
    await screen.findByText('Tuesday game');
    expect(screen.queryByText(/booked this for you/)).toBeNull();
  });

  it('shows a live offer with its countdown', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        offer_id: 'o1',
        offer_seats: 2,
        offer_expires_at: '2026-08-24T16:15:00Z',
      }),
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
      booking({
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        waitlist_position: 3,
      }),
    ]);
    render(<ClubsScreen />);
    // waitlistLabel(3) — the exact wording the event screen already uses
    // for this. A bare "Waiting for a seat" would not answer "should I
    // make other plans tonight?", which is why this row-level data (not a
    // generic status word) is what gets asserted.
    expect(await screen.findByText('3rd on the waitlist')).toBeTruthy();
    expect(screen.queryByText('Waiting for a seat')).toBeNull();
  });

  it('falls back to a generic waiting message when no position is known', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        waitlist_position: null,
      }),
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
      booking({
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
      }),
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
    fetchMyUpcomingBookings.mockResolvedValue([booking()]);
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
    //
    // The club list is the header and the chip row now, not a section of
    // cards, so that is where the assertion looks: the header naming the
    // club in scope is what proves the clubs half was not blanked. Asserted
    // with findAllByText, not findByText: the chip row now draws this same
    // one club's name a second time, in its own tile.
    expect(await screen.findAllByText(CLUB.name)).toHaveLength(2);
    expect(screen.getByRole('button', { name: `Manage ${CLUB.name}, ${CLUB.rhythm}` })).toBeTruthy();
    expect(screen.getByText('Could not load your games.')).toBeTruthy();
  });

  // A member can be waitlisted at two events at once and get promoted at
  // both — two live offers, two decline controls. "Decline the offer"
  // named nothing distinguishing; a screen reader (and getByLabelText)
  // could not tell them apart. Each label must name its own seats and
  // event.
  it('gives each of two simultaneous offers its own, distinct decline label', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        booking_id: 'b1',
        event_id: 'e1',
        event_title: 'Tuesday game',
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        offer_id: 'o1',
        offer_seats: 2,
        // After the beforeEach-frozen "now" of 2026-08-25T10:00:00Z, unlike
        // the fixture's original 2026-08-24 timestamps -- this test is
        // about distinct labels on two live offers, and the Task 13
        // fix-up's offer-expiry gate would otherwise render neither button.
        offer_expires_at: '2026-08-25T16:15:00Z',
      }),
      booking({
        booking_id: 'b2',
        event_id: 'e2',
        event_title: 'Thursday game',
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        offer_id: 'o2',
        offer_seats: 1,
        offer_expires_at: '2026-08-25T17:00:00Z',
      }),
    ]);
    render(<ClubsScreen />);

    const first = await screen.findByLabelText(
      'Decline the 2 seats offered for Tuesday game',
    );
    const second = await screen.findByLabelText(
      'Decline the 1 seat offered for Thursday game',
    );
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  // runBookingAction sets actionError straight from the data layer's
  // { error } channel — this pins that down against a regression that
  // swaps the real refusal sentence for GENERIC_ERROR.
  it('renders the data layer refusal verbatim, not a generic message', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({ booked_by: 'p2', booked_by_name: 'Jane P.' }),
    ]);
    declineBooking.mockResolvedValue({
      error: 'That is not your seat to change.',
    });
    render(<ClubsScreen />);
    fireEvent.click(
      await screen.findByLabelText('Decline the seat Jane P. booked'),
    );
    expect(
      await screen.findByText('That is not your seat to change.'),
    ).toBeTruthy();
  });

  // Every other test here renders exactly one row, so a regression that
  // hoists club_timezone to a page-level variable (instead of reading each
  // row's own field) would pass unnoticed. Two rows, same instant, two
  // different club timezones: the rendered local times must differ.
  it('formats each row in its own club timezone, not a shared one', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        booking_id: 'b1',
        event_title: 'Tuesday game',
        club_name: 'Riverside',
        club_timezone: 'America/New_York',
        starts_at: '2026-08-25T22:30:00Z',
      }),
      booking({
        booking_id: 'b2',
        event_title: 'Friday game',
        club_name: 'Oakfield',
        club_timezone: 'Asia/Tokyo',
        starts_at: '2026-08-25T22:30:00Z',
      }),
    ]);
    render(<ClubsScreen />);
    // Regex, not exact: each row's meta line is "<when> · <venue>" since
    // Task 8, so the formatted time is a substring of its element's text.
    expect(await screen.findByText(/Tue 25 Aug, 6:30 pm/)).toBeTruthy();
    expect(await screen.findByText(/Wed 26 Aug, 7:30 am/)).toBeTruthy();
  });
});

describe('Check-in', () => {
  it('shows the check-in control on a game whose window is open', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        status: 'confirmed',
        check_in_required: true,
        check_in_opens_at: new Date(Date.now() - 60_000).toISOString(),
        check_in_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
        check_in_state: null,
      }),
    ]);
    render(<ClubsScreen />);
    expect(
      await screen.findByRole('button', { name: /here/i }),
    ).toBeTruthy();
  });

  it('shows no control when the event did not ask for check-in', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        check_in_required: false,
        check_in_opens_at: null,
        check_in_closes_at: null,
      }),
    ]);
    render(<ClubsScreen />);
    await screen.findByText('Tuesday game');
    expect(screen.queryByRole('button', { name: /here/i })).toBeNull();
  });

  it('shows no control before the window opens', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        check_in_required: true,
        check_in_opens_at: new Date(Date.now() + 3_600_000).toISOString(),
        check_in_closes_at: new Date(Date.now() + 7_200_000).toISOString(),
      }),
    ]);
    render(<ClubsScreen />);
    await screen.findByText('Tuesday game');
    expect(screen.queryByRole('button', { name: /here/i })).toBeNull();
  });

  // my_upcoming_bookings returns waitlisted rows too, and record_attendance
  // refuses a waitlisted member with 23514 -- drawing a control guaranteed
  // to fail is worse than drawing none. See lib/attendance.ts's own
  // docstring on `checkInOpen` and the event screen's identical guard.
  it('shows no control on a waitlisted row', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        status: 'waitlisted',
        event_table_id: null,
        table_label: null,
        check_in_required: true,
        check_in_opens_at: new Date(Date.now() - 60_000).toISOString(),
        check_in_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ]);
    render(<ClubsScreen />);
    await screen.findByText('Tuesday game');
    expect(screen.queryByRole('button', { name: /here/i })).toBeNull();
  });

  it('reflects a state the member already recorded', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        check_in_required: true,
        check_in_opens_at: new Date(Date.now() - 60_000).toISOString(),
        check_in_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
        check_in_state: 'arrived',
      }),
    ]);
    render(<ClubsScreen />);
    const here = await screen.findByLabelText('Here: you');
    expect(here.getAttribute('aria-pressed')).toBe('true');
  });

  it('records against the right event', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        check_in_required: true,
        check_in_opens_at: new Date(Date.now() - 60_000).toISOString(),
        check_in_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByLabelText('Here: you'));
    await waitFor(() =>
      expect(recordAttendance).toHaveBeenCalledWith({
        eventId: 'e1',
        profileId: 'me',
        state: 'arrived',
      }),
    );
  });

  // Task 8 kept an in-progress game in this list so the member has
  // somewhere to check in -- which also keeps "Decline" on screen past
  // kickoff, where cancel_booking/decline_booking both now refuse with
  // "event already started". A button whose only possible outcome is an
  // error should not be offered.
  it('hides Decline on an in-progress booking someone else made, but keeps the check-in control', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        starts_at: '2026-08-25T08:00:00Z', // before the frozen "now" of 10:00
        booked_by: 'p2',
        booked_by_name: 'Jane P.',
        check_in_required: true,
        check_in_opens_at: new Date(Date.now() - 60_000).toISOString(),
        check_in_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ]);
    render(<ClubsScreen />);
    // The friend note is information, not an action -- it stays. Only the
    // dead-end Decline button is gated on `starts_at > now()`.
    expect(await screen.findByText('Jane P. booked this for you')).toBeTruthy();
    expect(
      screen.queryByLabelText('Decline the seat Jane P. booked'),
    ).toBeNull();
    expect(await screen.findByLabelText('Here: you')).toBeTruthy();
  });

  it('hides "Leave the waitlist" on an in-progress, still-waitlisted booking', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        starts_at: '2026-08-25T08:00:00Z', // before the frozen "now" of 10:00
        status: 'waitlisted',
        event_table_id: null,
        table_label: null,
      }),
    ]);
    render(<ClubsScreen />);
    await screen.findByText('Tuesday game');
    expect(screen.queryByText('Leave the waitlist')).toBeNull();
    expect(
      screen.queryByLabelText('Leave the waitlist for Tuesday game'),
    ).toBeNull();
  });
});

// `promote_waitlist` caps an offer's `expires_at` at the event's own
// `starts_at`, and `sweep_promotion_offers` only clears a lapsed offer
// every five minutes -- so `my_upcoming_bookings` can keep returning offer
// fields for a while after the offer itself has expired. The row must gate
// "Take the seats" / "No thanks" on the OFFER's own expiry, not on
// `starts_at`, because `accept_promotion_offer` refuses a lapsed offer
// (`offer expired`) regardless of whether the game has started.
describe('Promotion offer expiry', () => {
  it('renders no actionable offer buttons once the offer itself has expired', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        offer_id: 'o1',
        offer_seats: 2,
        offer_expires_at: '2026-08-25T09:00:00Z', // before the frozen "now" of 10:00
      }),
    ]);
    render(<ClubsScreen />);
    expect(
      await screen.findByText(
        "That offer has expired — you're still on the waitlist.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Take the 2 seats')).toBeNull();
    expect(
      screen.queryByLabelText('Decline the 2 seats offered for Tuesday game'),
    ).toBeNull();
  });

  it('still renders the offer buttons while the offer has not yet expired', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        offer_id: 'o1',
        offer_seats: 2,
        offer_expires_at: '2026-08-25T12:00:00Z', // after the frozen "now" of 10:00
      }),
    ]);
    render(<ClubsScreen />);
    expect(await screen.findByLabelText('Take the 2 seats')).toBeTruthy();
    expect(
      await screen.findByLabelText(
        'Decline the 2 seats offered for Tuesday game',
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(
        "That offer has expired — you're still on the waitlist.",
      ),
    ).toBeNull();
  });

  // The scenario the finding was actually about: Task 8 keeps an
  // in-progress game in "Your games" for check-in, and that same game can
  // carry a now-lapsed offer the sweep hasn't cleared yet. The row should
  // offer the one write that can still succeed (check-in) and neither of
  // the two that are now guaranteed refusals.
  it('shows the check-in control but no offer buttons on an in-progress game with a lapsed offer', async () => {
    fetchMyUpcomingBookings.mockResolvedValue([
      booking({
        starts_at: '2026-08-25T08:00:00Z', // before the frozen "now" of 10:00
        status: 'confirmed',
        offer_id: 'o1',
        offer_seats: 2,
        offer_expires_at: '2026-08-25T09:00:00Z', // before the frozen "now" of 10:00
        check_in_required: true,
        check_in_opens_at: new Date(Date.now() - 60_000).toISOString(),
        check_in_closes_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ]);
    render(<ClubsScreen />);
    expect(await screen.findByLabelText('Here: you')).toBeTruthy();
    expect(screen.queryByLabelText('Take the 2 seats')).toBeNull();
    expect(
      screen.queryByLabelText('Decline the 2 seats offered for Tuesday game'),
    ).toBeNull();
  });
});
