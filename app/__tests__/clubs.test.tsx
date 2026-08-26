import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClubsScreen from '../clubs/index';

const push = vi.fn();
const replace = vi.fn();

// Mutable so a test can put `?imported=40` on the URL the way
// `app/clubs/[id]/import.tsx` does after a successful import.
const searchParams: Record<string, string> = { id: 'club-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  // Renders as a real anchor carrying the href, so a test can assert where a
  // link points. It used to render its children and drop `href` on the
  // floor, which made every `Link` in these screens untestable. The club
  // cards below nest a Pressable inside via `asChild`; a div inside an
  // anchor is valid, and the existing role-based queries still find it.
  //
  // Its one known infidelity: the real `Link asChild` merges `href`,
  // `onPress`, and `role="link"` straight onto its child rather than
  // wrapping it, whereas this mock wraps `children` in a genuine `<a>`. So a
  // test asserting `data-href` is verifying that `Link` received the href it
  // was given, not that the production DOM has this nested shape, and
  // `getByRole('button', …)` matches here — against the Pressable's own
  // `accessibilityRole` — where the real build would expose `role="link"`
  // on the merged anchor instead. `Element.closest` includes the element
  // itself in its match, which is why the `closest('a')` assertions below
  // still read correctly against this wrapped-anchor shape even though it
  // isn't the shape the web build actually produces.
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a data-href={href}>{children}</a>
  ),
  useRouter: () => ({ push, replace }),
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

const fetchMyClubs = vi.fn();
const fetchClub = vi.fn();
const fetchRoster = vi.fn();
const fetchPendingInvites = vi.fn();
const importRoster = vi.fn();
const fetchUpcomingEvents = vi.fn();
const fetchMyUpcomingBookings = vi.fn();
const commitBooking = vi.fn();
const cancelBooking = vi.fn();
const fetchProfile = vi.fn();

// One partial mock for the whole file, not one per describe block. Two
// `vi.mock` calls for the same specifier are both hoisted and only one
// survives, so the second block's `...actual` spread silently lost whatever
// the first factory did not list — which is how `MAX_ROSTER_ROWS` came back
// undefined at render time. `parseRoster`, `canInvite` and `MAX_ROSTER_ROWS`
// stay real here on purpose: they are pure and the screens' behaviour under
// test depends on what they actually do.
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchMyClubs: (...args: unknown[]) => fetchMyClubs(...args),
    fetchClub: (...args: unknown[]) => fetchClub(...args),
    fetchRoster: (...args: unknown[]) => fetchRoster(...args),
    fetchPendingInvites: (...args: unknown[]) => fetchPendingInvites(...args),
    importRoster: (...args: unknown[]) => importRoster(...args),
  };
});

// Same pattern as the lib/clubs mock above: `formatEventWhen` stays real
// (it is pure, and the whole point of the timezone test below is to exercise
// its actual Intl formatting), only `fetchUpcomingEvents` is stubbed.
vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchUpcomingEvents: (...args: unknown[]) => fetchUpcomingEvents(...args),
  };
});

// Same one-mock-per-specifier rule as above. `offerCountdown`, `waitlistLabel`
// and `needsAFourth` stay real: the dashboard's derivations run through them
// and stubbing them would test the stub rather than the screen.
vi.mock('../../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bookings')>();
  return {
    ...actual,
    fetchMyUpcomingBookings: (...args: unknown[]) => fetchMyUpcomingBookings(...args),
    commitBooking: (...args: unknown[]) => commitBooking(...args),
    cancelBooking: (...args: unknown[]) => cancelBooking(...args),
  };
});

vi.mock('../../lib/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/profile')>();
  return { ...actual, fetchProfile: (...args: unknown[]) => fetchProfile(...args) };
});

const CLUB = {
  id: 'club-1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private' as const,
  timezone: 'America/New_York',
};

// Shapes mirrored from lib/dashboard.test.ts's own `booking()`/`event()`
// helpers, so the fixtures the screen renders are the same ones the
// derivation module is tested against.
//
// `booked_by` is the fixed test-user: a booking somebody else made carries an
// extra "X booked this for you" line and a Decline button, which is a
// different branch of the row than the one most tests here are about.
const BOOKING = {
  booking_id: 'booking-1',
  group_id: 'group-1',
  event_id: 'event-9',
  club_id: 'club-1',
  club_name: 'Riverside Mah Jongg',
  event_title: 'Sunday social',
  // Relative, for the same reason EVENT's own `starts_at` is (see below):
  // a fixed calendar date silently turns every row derived from this fixture
  // into a past game once the clock rolls past it, and the row's
  // seat-management controls are gated on `starts_at > now()`.
  starts_at: new Date(Date.now() + 14 * 864e5).toISOString(),
  club_timezone: 'America/New_York',
  venue_name: 'The hall',
  event_table_id: 'table-9',
  table_label: 'Table 1',
  status: 'confirmed' as const,
  booked_by: 'test-user',
  booked_by_name: 'You',
  offer_id: null,
  offer_seats: null,
  offer_expires_at: null,
  waitlist_position: null,
  check_in_required: false,
  check_in_state: null,
  check_in_opens_at: null,
  check_in_closes_at: null,
};

const EVENT = {
  id: 'event-1',
  club_id: 'club-1',
  series_id: null,
  title: 'Thursday night',
  venue_id: 'venue-1',
  venue_name: "Sara's place",
  notes: '',
  // Relative to now, never a fixed calendar date. `buildDashboardRows` drops
  // any event whose start is already past, so a hardcoded timestamp makes
  // every test that spreads EVENT without overriding `starts_at` fail on a
  // calendar rollover rather than on a code change — this fixture was one
  // week from going red that way. Fake timers are deliberately NOT installed
  // for this file: the other tests here read the real clock and freezing it
  // would disturb all of them for no benefit.
  starts_at: new Date(Date.now() + 7 * 864e5).toISOString(),
  ends_at: new Date(Date.now() + 7 * 864e5 + 3 * 3600e3).toISOString(),
  status: 'published' as const,
  occurrence_date: null,
  overrides: [],
  table_count: 1,
  event_tables: [{ id: 'table-1', capacity: 4, label: 'Table 1' }],
  bookings: [] as {
    profile_id: string;
    status: 'confirmed' | 'waitlisted' | 'cancelled' | 'declined';
    event_table_id: string | null;
  }[],
  check_in_required: false,
};

// A published game one seat short at its only table, starting soon enough for
// `needsAFourth`'s 48-hour window — the shape that raises a need-a-fourth
// card, and (having a free seat) a joinable row under it as well.
function oneShortEvent(startsAt: string) {
  return {
    ...EVENT,
    id: 'e1',
    club_id: CLUB.id,
    starts_at: startsAt,
    bookings: [
      { profile_id: 'a', status: 'confirmed' as const, event_table_id: 'table-1' },
      { profile_id: 'b', status: 'confirmed' as const, event_table_id: 'table-1' },
      { profile_id: 'c', status: 'confirmed' as const, event_table_id: 'table-1' },
    ],
  };
}

/** The same game as `oneShortEvent`, re-read after the viewer took the seat. */
function seatedEvent(startsAt: string) {
  const event = oneShortEvent(startsAt);
  return {
    ...event,
    bookings: [
      ...event.bookings,
      {
        profile_id: 'test-user',
        status: 'confirmed' as const,
        event_table_id: 'table-1',
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.id = 'club-1';
  fetchClub.mockResolvedValue(CLUB);
  fetchRoster.mockResolvedValue([]);
  fetchPendingInvites.mockResolvedValue([]);
  fetchUpcomingEvents.mockResolvedValue([]);
  importRoster.mockResolvedValue({ created: 2, error: null });
  // Before Task 8 nothing mocked lib/bookings or lib/profile, so every test
  // in this file let the real fetch fail against the placeholder Supabase env
  // and land in the dashboard's `bookingsFailed` branch by accident. These
  // give the whole file a defined starting state instead: a member with no
  // games, no name set, and a booking write that succeeds.
  fetchMyUpcomingBookings.mockResolvedValue([]);
  commitBooking.mockResolvedValue({ result: null, error: null });
  cancelBooking.mockResolvedValue({ error: null });
  fetchProfile.mockResolvedValue(null);
});

describe('clubs list', () => {
  it('offers a way to start one when the member has no clubs', async () => {
    fetchMyClubs.mockResolvedValueOnce([]);
    render(<ClubsScreen />);
    expect(await screen.findByText(/not in a club yet/i)).toBeTruthy();
    expect(screen.getByText('Start a club')).toBeTruthy();
  });

  it('lists the clubs a member belongs to', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thursday evenings')).toBeTruthy();
  });

  // "Your games" (Task 13) stacked a whole section above the club list with
  // no `scroll` prop on Screen, unlike every other list screen
  // (app/clubs/[id]/index.tsx, the event screen). A member with a few games
  // and a few clubs could produce a page taller than the viewport with no
  // way to reach "Start another club" or "Your profile". Only the populated
  // main render needs this — the loading/ready spinners and the load-failed
  // error banner are all short, centered, single-purpose content.
  it('lets the populated screen scroll', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByTestId('screen-scroll')).toBeTruthy();
  });

  // The one that matters: fetchMyClubs returns null on a failed load and []
  // when the member genuinely has no clubs. Rendering the empty-state copy
  // for both would tell a member whose fetch just failed that their clubs
  // are gone. app/profile.tsx shipped the equivalent bug once already — a
  // blank-but-editable form after a failed fetch that members then
  // overwrote their real profile through.
  it('shows an error rather than an empty list when the load fails', async () => {
    fetchMyClubs.mockResolvedValueOnce(null);
    render(<ClubsScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText(/not in a club yet/i)).toBeNull();
  });
});

describe('dashboard artboard', () => {
  it('heads the page with the club count and the profile avatar', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue({ id: 'test-user', display_name: 'Jean Wu', skill_level: null, avatar_url: null, timezone: 'America/New_York' });

    render(<ClubsScreen />);

    expect(await screen.findByText('All your clubs')).toBeTruthy();
    expect(screen.getByText('2 clubs')).toBeTruthy();
    expect(screen.getByText('JW')).toBeTruthy();
  });

  // The rows were inert: the one thing a member wants from a game they can
  // see is to open it.
  it('opens the game when a row is tapped', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValueOnce([BOOKING]);
    render(<ClubsScreen />);
    const row = await screen.findByRole('button', { name: 'Open Sunday social' });
    expect(row.closest('a')?.getAttribute('data-href')).toBe(
      '/clubs/club-1/events/event-9',
    );
  });

  // The row's own controls must stay outside that press target, or a Join
  // tap would land on two competing targets at once.
  it('keeps the Join button outside the row press target', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    fetchUpcomingEvents.mockResolvedValueOnce([
      {
        ...EVENT,
        id: 'open',
        club_id: CLUB.id,
        title: 'Open game',
        bookings: [
          { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
        ],
      },
    ]);
    render(<ClubsScreen />);
    const join = await screen.findByRole('button', { name: /Join Open game/ });
    expect(join.closest('a')).toBeNull();
  });

  it('narrows the games list to the picked club', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...BOOKING, event_id: 'e1', club_id: CLUB.id, club_name: CLUB.name, event_title: 'Riverside game' },
      { ...BOOKING, booking_id: 'b2', event_id: 'e2', club_id: 'club-2', club_name: 'Harbour', event_title: 'Harbour game' },
    ]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    expect(await screen.findByText('Riverside game')).toBeTruthy();
    expect(screen.getByText('Harbour game')).toBeTruthy();

    // Two buttons answer to "Harbour": the club chip up top and the club's
    // own card down in "Your clubs". The chip is the first in document
    // order — `getByRole` would refuse the ambiguity rather than pick.
    fireEvent.click(screen.getAllByRole('button', { name: 'Harbour' })[0]);

    expect(screen.queryByText('Riverside game')).toBeNull();
    expect(screen.getByText('Harbour game')).toBeTruthy();
    expect(screen.getByText('Your club')).toBeTruthy();
  });

  it('shows skeletons before the first load resolves', () => {
    fetchMyClubs.mockReturnValue(new Promise(() => {}));
    fetchMyUpcomingBookings.mockReturnValue(new Promise(() => {}));
    fetchUpcomingEvents.mockReturnValue(new Promise(() => {}));
    fetchProfile.mockReturnValue(new Promise(() => {}));

    render(<ClubsScreen />);

    expect(screen.getAllByTestId('skeleton')).toHaveLength(3);
  });

  it('takes a seat from a need-a-fourth card and raises the notice', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([
      {
        ...EVENT,
        id: 'e1',
        club_id: CLUB.id,
        title: 'Thursday night',
        starts_at: soon,
        status: 'published',
        event_tables: [{ id: 'table-1', capacity: 4, label: 'Table 1' }],
        bookings: [
          { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
          { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
          { profile_id: 'c', status: 'confirmed', event_table_id: 'table-1' },
        ],
      },
    ]);
    fetchProfile.mockResolvedValue(null);
    commitBooking.mockResolvedValue({ result: {}, error: null });

    render(<ClubsScreen />);

    const take = await screen.findByRole('button', { name: /I'm in/ });
    fireEvent.click(take);

    await waitFor(() => expect(commitBooking).toHaveBeenCalled());
    expect(commitBooking.mock.calls[0][0]).toMatchObject({
      eventId: 'e1',
      players: ['test-user'],
      preferredTableId: 'table-1',
      allowSplit: false,
    });
    expect(await screen.findByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('surfaces a failed take without raising a notice', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([
      {
        ...EVENT,
        id: 'e1',
        club_id: CLUB.id,
        starts_at: soon,
        status: 'published',
        event_tables: [{ id: 'table-1', capacity: 4, label: 'Table 1' }],
        bookings: [
          { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
          { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
          { profile_id: 'c', status: 'confirmed', event_table_id: 'table-1' },
        ],
      },
    ]);
    fetchProfile.mockResolvedValue(null);
    commitBooking.mockResolvedValue({ result: null, error: 'That seat just went.' });

    render(<ClubsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /I'm in/ }));

    expect(await screen.findByText('That seat just went.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  // The need-a-fourth card advertises ONE seat to every eligible member of
  // the club at once, so two people pressing "I'm in" within a second of each
  // other is the expected case, not a rare race. `commit_booking` answers the
  // loser with `error: null` and `outcome: 'waitlisted'` — a success as far
  // as the error channel is concerned. Reading only `{ error }` therefore
  // told that member "You're in", in a green banner, directly above a row
  // that said they were waiting. The event screen's `bookSeat` already reads
  // `result.outcome` for exactly this; these two pin the dashboard to the
  // same behaviour and the same wording (`waitlistLabel`).
  it('reports the waitlist outcome, not "You\'re in", when the advertised seat has gone', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([oneShortEvent(soon)]);
    fetchProfile.mockResolvedValue(null);
    commitBooking.mockResolvedValue({
      result: {
        outcome: 'waitlisted',
        split: false,
        group_id: 'g1',
        waitlist_position: 2,
        offer: null,
        placements: [],
      },
      error: null,
    });

    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /I'm in/ }));

    // The banner names the game, exactly as the seated half does. Matched by
    // prefix: the rest is the formatted date, which moves with the clock.
    expect(await screen.findByText(/^2nd on the waitlist — /)).toBeTruthy();
    expect(screen.queryByText(/You're in/)).toBeNull();
  });

  it('reports the waitlist outcome when a Join lands on the waitlist', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    // Two of four seats taken: joinable, but not one short, so this raises a
    // row with a Join button and no need-a-fourth card.
    fetchUpcomingEvents.mockResolvedValue([
      {
        ...EVENT,
        id: 'open',
        club_id: CLUB.id,
        title: 'Open game',
        bookings: [
          { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
          { profile_id: 'b', status: 'confirmed', event_table_id: 'table-1' },
        ],
      },
    ]);
    fetchProfile.mockResolvedValue(null);
    commitBooking.mockResolvedValue({
      result: {
        outcome: 'waitlisted',
        split: false,
        group_id: 'g1',
        waitlist_position: 1,
        offer: null,
        placements: [],
      },
      error: null,
    });

    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Join Open game/ }));

    expect(await screen.findByText(/^1st on the waitlist — .*Open game$/)).toBeTruthy();
  });

  // The alerts are derived from `events`, not from `bookings`. Reloading only
  // the bookings after a successful write left the card that was just acted
  // on sitting there with a live "I'm in" button, whose only possible outcome
  // is the `bookings_one_active_per_person_idx` refusal.
  it('drops the need-a-fourth card once the seat has been taken', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchUpcomingEvents
      .mockResolvedValueOnce([oneShortEvent(soon)])
      .mockResolvedValue([seatedEvent(soon)]);
    fetchMyUpcomingBookings
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { ...BOOKING, event_id: 'e1', starts_at: soon, event_title: 'Thursday night' },
      ]);
    fetchProfile.mockResolvedValue(null);
    commitBooking.mockResolvedValue({
      result: {
        outcome: 'seated',
        split: false,
        group_id: 'g1',
        waitlist_position: null,
        offer: null,
        placements: [],
      },
      error: null,
    });

    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /I'm in/ }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /I'm in/ })).toBeNull(),
    );
  });

  // Same staleness, reached through the row's Join button rather than the
  // card's: the game the member just joined was also one seat short, so the
  // card above it has to go too.
  it('drops the need-a-fourth card once the same game has been joined', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchUpcomingEvents
      .mockResolvedValueOnce([oneShortEvent(soon)])
      .mockResolvedValue([seatedEvent(soon)]);
    fetchMyUpcomingBookings
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { ...BOOKING, event_id: 'e1', starts_at: soon, event_title: 'Thursday night' },
      ]);
    fetchProfile.mockResolvedValue(null);
    commitBooking.mockResolvedValue({
      result: {
        outcome: 'seated',
        split: false,
        group_id: 'g1',
        waitlist_position: null,
        offer: null,
        placements: [],
      },
      error: null,
    });

    render(<ClubsScreen />);
    // The card has to be on screen before the join, or this test would pass
    // just as well against a screen that never rendered one — which is what
    // it asserted before.
    expect(await screen.findByRole('button', { name: /I'm in/ })).toBeTruthy();
    fireEvent.click(
      await screen.findByRole('button', { name: /Join Thursday night/ }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /I'm in/ })).toBeNull(),
    );
  });

  // The same staleness one more time, reached through a row action rather
  // than a booking write. `runBookingAction` — decline, leave-waitlist,
  // accept-offer, decline-offer — used to reload only the bookings, while the
  // alerts and joinable rows are derived from `events`. A member who left a
  // waitlist was therefore still counted as `waitlisted` by `viewerIsIn`, so
  // the seat they had just freed produced neither a Join row nor a "Need a
  // 4th" card until the screen remounted.
  it('re-reads the events, not just the bookings, after leaving a waitlist', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const short = oneShortEvent(soon);
    const waiting = {
      ...short,
      bookings: [
        ...short.bookings,
        {
          profile_id: 'test-user',
          status: 'waitlisted' as const,
          event_table_id: null,
        },
      ],
    };
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchUpcomingEvents
      .mockResolvedValueOnce([waiting])
      .mockResolvedValue([short]);
    fetchMyUpcomingBookings
      .mockResolvedValueOnce([
        {
          ...BOOKING,
          event_id: 'e1',
          starts_at: soon,
          event_title: 'Thursday night',
          status: 'waitlisted' as const,
          event_table_id: null,
          table_label: null,
          waitlist_position: 2,
        },
      ])
      .mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    // While waitlisted there is no card: `viewerIsIn` counts a waitlist spot
    // as being in the game.
    expect(await screen.findByText('2nd on the waitlist')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /I'm in/ })).toBeNull();

    fireEvent.click(
      screen.getByLabelText('Leave the waitlist for Thursday night'),
    );

    expect(
      await screen.findByRole('button', { name: /I'm in/ }),
    ).toBeTruthy();
    expect(cancelBooking).toHaveBeenCalledWith('booking-1');
  });

  // The other half of the same call: a standing confirmation describes an
  // earlier action, and "1st on the waitlist" describes the very waitlist
  // spot this one gives up. It used to stay on screen afterwards.
  it('clears the standing notice when the member leaves that waitlist', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchUpcomingEvents.mockResolvedValue([
      {
        ...EVENT,
        id: 'open',
        club_id: CLUB.id,
        title: 'Open game',
        starts_at: soon,
        bookings: [
          { profile_id: 'a', status: 'confirmed' as const, event_table_id: 'table-1' },
          { profile_id: 'b', status: 'confirmed' as const, event_table_id: 'table-1' },
        ],
      },
    ]);
    fetchMyUpcomingBookings
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...BOOKING,
          event_id: 'open',
          starts_at: soon,
          event_title: 'Open game',
          status: 'waitlisted' as const,
          event_table_id: null,
          table_label: null,
          waitlist_position: 1,
        },
      ])
      .mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);
    commitBooking.mockResolvedValue({
      result: {
        outcome: 'waitlisted',
        split: false,
        group_id: 'g1',
        waitlist_position: 1,
        offer: null,
        placements: [],
      },
      error: null,
    });

    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Join Open game/ }));

    // Two different strings now: the banner names the game, the row's own
    // seat status does not. Asserted separately — the previous
    // `findAllByText(...).length > 0` would have been satisfied by either
    // one alone, which is exactly the ambiguity naming the game removes.
    expect(await screen.findByText(/^1st on the waitlist — .*Open game$/)).toBeTruthy();
    expect(screen.getByText('1st on the waitlist')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Leave the waitlist for Open game'));

    await waitFor(() =>
      expect(screen.queryAllByText(/1st on the waitlist/)).toHaveLength(0),
    );
  });

  it('offers Join on an open game and Seated on a held one', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...BOOKING, event_id: 'mine', club_id: CLUB.id, club_name: CLUB.name, event_title: 'My game', status: 'confirmed' },
    ]);
    fetchUpcomingEvents.mockResolvedValue([
      { ...EVENT, id: 'open', club_id: CLUB.id, title: 'Open game', status: 'published', event_tables: [{ id: 't', capacity: 4, label: 'T' }], bookings: [] },
    ]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    expect(await screen.findByText('Seated')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Join Open game/ })).toBeTruthy();
  });

  it('shows the dashed empty state when nothing is coming up', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    expect(await screen.findByText('Nothing else coming up.')).toBeTruthy();
  });

  // The chip row only renders above one club, so a one-club member's
  // `selected` stays ALL_CLUBS forever. Gating "Host a table" on
  // `selected !== ALL_CLUBS` therefore hid it from exactly the member most
  // likely to want it: their empty state was a dashed box and nothing else.
  // The test above seeds this same state and asserts only the copy, which is
  // how it passed straight over the gap.
  it('offers Host a table to a one-club member with nothing coming up', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Host a table' }));
    expect(push).toHaveBeenCalledWith(`/clubs/${CLUB.id}/events/new`);
  });

  // The other half of the same rule: with several clubs and no chip picked,
  // there is no single club the button could mean, so none is drawn rather
  // than one that guesses.
  it('draws no Host a table button across several clubs with no chip picked', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    expect(await screen.findByText('Nothing else coming up.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Host a table' })).toBeNull();
  });

  // takeBusy gated take/join and actionBusy gated decline/offer/waitlist,
  // with nothing between them — so a member could start a decline while a
  // join was still in flight and have the two reloadAfterBooking calls race
  // to set `events` and `bookings`.
  it('locks the other booking actions while one is in flight', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    // A waitlisted booking on one game (a Leave the waitlist button) and a
    // separate open game (a Join button) — one of each family of action.
    fetchMyUpcomingBookings.mockResolvedValue([
      {
        ...BOOKING,
        event_id: 'held',
        starts_at: soon,
        event_title: 'Held game',
        status: 'waitlisted' as const,
        event_table_id: null,
        table_label: null,
        waitlist_position: 2,
      },
    ]);
    fetchUpcomingEvents.mockResolvedValue([
      {
        ...EVENT,
        id: 'open',
        club_id: CLUB.id,
        title: 'Open game',
        starts_at: soon,
        bookings: [
          { profile_id: 'a', status: 'confirmed' as const, event_table_id: 'table-1' },
        ],
      },
    ]);
    // Never resolves while the assertion runs, so the first write stays in
    // flight for the whole test.
    let release: (value: { result: null; error: null }) => void = () => {};
    commitBooking.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Join Open game/ }));

    await waitFor(() =>
      expect(
        screen
          .getByLabelText('Leave the waitlist for Held game')
          .getAttribute('aria-disabled'),
      ).toBe('true'),
    );

    release({ result: null, error: null });
  });
});

import ImportRosterScreen from '../clubs/[id]/import';

describe('roster import', () => {
  it('reports skipped rows instead of dropping them silently', async () => {
    render(<ImportRosterScreen />);
    const field = screen.getByLabelText('Roster CSV');
    fireEvent.change(field, {
      target: { value: 'name,email\nJane,jane@example.com\nBad,not-an-email' },
    });
    fireEvent.click(screen.getByText('Check the file'));
    expect(await screen.findByText(/1 person ready, 1 row skipped/)).toBeTruthy();
    expect(screen.getByText(/Row 3: Not a valid email address/)).toBeTruthy();
  });

  // The end-to-end shape of the parser fix: a real Google Sheets export of
  // "Last, First" reaches the preview as one person, not one skipped row.
  it('accepts a quoted name containing a comma', async () => {
    render(<ImportRosterScreen />);
    fireEvent.change(screen.getByLabelText('Roster CSV'), {
      target: { value: 'name,email\n"Doe, Jane",jane@example.com' },
    });
    fireEvent.click(screen.getByText('Check the file'));
    expect(await screen.findByText(/1 person ready$/)).toBeTruthy();
    expect(screen.getByText('Doe, Jane')).toBeTruthy();
  });
});

import ClubDetailScreen from '../clubs/[id]/index';
import { eventStatusLine, formatEventWhen } from '../../lib/events';

// A guard-ordering regression: the club detail screen used to check
// `if (loading || !ready) return <spinner>` before `if (!session) return
// <Redirect>`. `ready` is only set inside an effect gated on a signed-in
// `userId`, so a signed-out visitor could never make `ready` true and was
// stuck on the spinner forever instead of being sent to sign in — the same
// "a guard that can never resolve returns before the guard that would
// rescue you" defect already fixed once in the notifications screen and
// once in app/index.tsx's storage race. Invite links point at club pages,
// so this matters for anyone opening a stale link or an expired session,
// not just a hypothetical.
describe('club detail screen', () => {
  it('redirects to sign-in instead of spinning forever when signed out', async () => {
    useSessionMock.mockReturnValueOnce({ session: null, loading: false });
    render(<ClubDetailScreen />);
    const redirect = await screen.findByTestId('redirect');
    expect(redirect.getAttribute('data-href')).toBe('/sign-in');
  });

  // `club_members` rows are written only by `create_club` and
  // `accept_club_invite`, both of which require `auth.uid()`, so a roster row
  // always belongs to someone who has signed in. The screen nonetheless
  // labelled an empty display_name "Invited — not signed in yet" — a claim
  // that could never be true, and one that started firing on real members
  // once magic-link signup began producing `display_name = ''` with nothing
  // to make them set one.
  it('does not call a member with no name an uninvited guest', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: '', skill_level: null },
    ]);
    render(<ClubDetailScreen />);
    expect(await screen.findByText('Member')).toBeTruthy();
    expect(screen.queryByText(/not signed in yet/i)).toBeNull();
  });

  // `importRoster` writes to `club_invites`, which `fetchRoster` never read.
  // A host who pasted forty people was redirected to a screen that still said
  // "1 member" and showed no trace of them.
  it('lists unaccepted invites as a separate Invited section', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    fetchPendingInvites.mockResolvedValue([
      { id: 'i1', email: 'jane@example.com', display_name: 'Jane Doe', skill_level: null },
      { id: 'i2', email: 'sam@example.com', display_name: null, skill_level: null },
    ]);
    render(<ClubDetailScreen />);
    expect(await screen.findByText('2 invited')).toBeTruthy();
    expect(screen.getByText('1 member')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    // No display_name on the invite, so the email is the only thing the club
    // knows about this person — showing it beats showing nothing.
    expect(screen.getByText('sam@example.com')).toBeTruthy();
  });

  it('confirms an import instead of ignoring the imported parameter', async () => {
    searchParams.imported = '40';
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    render(<ClubDetailScreen />);
    expect(await screen.findByText(/40 invitations sent/)).toBeTruthy();
  });

  // The roster used to print a member's level as plain text with no glyph
  // at all -- one of the three inconsistent ways this app drew the same
  // idea (TableCard's pips, the old SkillDotsIcon on the profile picker,
  // and this screen's bare text). It now gets the same three-pip glyph
  // beside the word, via SkillLevelPips -- but only for a member who has
  // actually set a level. `skill_level: null` means "not set", not a
  // fourth level, and must never draw as SkillTierPips's `mixed` dash: a
  // person can be unset, but never "any level" (that's a table's `mixed`,
  // a different type entirely -- see SkillLevelPips's own docstring).
  it('shows the skill pip glyph beside the word for a member with a level, and nothing for one without', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: 'intermediate' },
      { profile_id: 'user-2', role: 'member', display_name: 'Ben', skill_level: null },
    ]);
    render(<ClubDetailScreen />);

    expect(await screen.findByText('Ada')).toBeTruthy();
    expect(screen.getByText('Ben')).toBeTruthy();
    expect(screen.getByText('Intermediate')).toBeTruthy();

    // Ada's glyph -- the whole roster only has Ada's level to draw, so a
    // total of three pips (two filled, one outlined) proves Ben got none.
    expect(screen.getAllByTestId('pip-filled')).toHaveLength(2);
    expect(screen.getAllByTestId('pip-outline')).toHaveLength(1);

    // No dash anywhere on the roster, for Ben (not set) or anyone else --
    // the mutation this guards against is treating "not set" as "mixed".
    expect(screen.queryByTestId('pip-dash')).toBeNull();
  });

  // TabBar navigates with router.replace off an entry route that is itself a
  // Redirect, so the history stack is typically one deep. A club screen with
  // no bar and (below) no back button would be a dead end on native.
  it('carries the tab bar', async () => {
    render(<ClubDetailScreen />);
    expect(await screen.findByRole('button', { name: 'Club' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
  });

  it('carries the tab bar while the club is still loading', () => {
    // A promise that never settles: the screen stays in its !ready state for
    // the life of the test.
    fetchClub.mockReturnValueOnce(new Promise(() => {}));
    fetchRoster.mockReturnValueOnce(new Promise(() => {}));
    render(<ClubDetailScreen />);
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  it('carries the tab bar when the club cannot be loaded', async () => {
    fetchClub.mockResolvedValueOnce(null);
    render(<ClubDetailScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
  });

  it('names the club in the dashboard header, with the avatar to profile', async () => {
    fetchProfile.mockResolvedValue({
      id: 'test-user',
      display_name: 'Pat Chen',
      skill_level: 'intermediate',
      avatar_url: null,
      timezone: 'America/New_York',
    });
    render(<ClubDetailScreen />);
    expect(await screen.findByText('Your club')).toBeTruthy();
    expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thursday evenings')).toBeTruthy();
    expect(await screen.findByText('PC')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Your profile' }));
    expect(push).toHaveBeenCalledWith('/profile');
  });

  // Removed with the tab bar's arrival: the Club tab is the same
  // destination, so the chevron was a second way to do one thing.
  it('no longer draws its own back link', async () => {
    render(<ClubDetailScreen />);
    expect(await screen.findByText('Upcoming')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to your clubs' })).toBeNull();
  });
});

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('club detail screen upcoming events', () => {
  // This club's timezone is Asia/Tokyo, deliberately NOT America/New_York —
  // the value `TZ` is pinned to for the whole suite (package.json's `test`
  // script). If the screen ever stopped threading `club.timezone` through to
  // `formatEventWhen` and fell back to whatever timezone the process (or a
  // bare `toLocaleString()`) resolves to by default, Node would render this
  // event in the suite's own America/New_York timezone instead — a
  // completely different clock hour and, for this instant, a different
  // calendar day too. A same-timezone fixture (e.g. reusing plain `CLUB`,
  // whose timezone already happens to be America/New_York) would pass either
  // way and prove nothing; that is the trap this branch's report already
  // flagged twice. Checked concretely below by asserting the Tokyo and
  // New-York renderings of the same instant actually differ, and separately
  // by rerunning this file with `TZ=Pacific/Auckland npm test -- clubs.test`
  // (a third timezone, matching neither the club's nor the default suite
  // env) — still green, because the expected string is computed through the
  // real `formatEventWhen('Asia/Tokyo')` call, never off the process clock.
  const TOKYO_CLUB = { ...CLUB, timezone: 'Asia/Tokyo' };

  const EVENT = {
    id: 'event-1',
    club_id: 'club-1',
    series_id: null,
    title: 'Thursday Mahjong',
    venue_id: 'venue-1',
    venue_name: 'The Annexe',
    notes: '',
    starts_at: '2026-09-03T13:00:00.000Z',
    ends_at: '2026-09-03T16:00:00.000Z',
    status: 'published' as const,
    occurrence_date: null,
    overrides: [],
    table_count: 3,
    // Defaults so every test below can render the card without crashing on
    // eventStatusLine's undefined-array access — a table nobody has booked,
    // for a member other than the fixed test-user. Tests that care about a
    // specific status line override these explicitly (see the dedicated
    // "says where you stand" test and the eventStatusLine block below).
    event_tables: [{ id: 't1', capacity: 4, label: 'Table 1' }],
    bookings: [] as {
      profile_id: string;
      status: 'confirmed' | 'waitlisted' | 'cancelled' | 'declined';
      event_table_id: string | null;
    }[],
  };

  beforeEach(() => {
    fetchClub.mockResolvedValue(TOKYO_CLUB);
  });

  it('renders the event start time in the club timezone, not the device/process one', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'member', display_name: 'Ada', skill_level: null },
    ]);
    fetchUpcomingEvents.mockResolvedValue([EVENT]);

    const tokyoWhen = formatEventWhen(EVENT.starts_at, 'Asia/Tokyo');
    const newYorkWhen = formatEventWhen(EVENT.starts_at, 'America/New_York');
    // Guards the fixture itself: if these ever matched, the assertion below
    // would pass regardless of which timezone the screen actually used.
    expect(tokyoWhen).not.toBe(newYorkWhen);

    render(<ClubDetailScreen />);

    expect(await screen.findByText('Thursday Mahjong')).toBeTruthy();
    expect(
      screen.getByText(new RegExp(escapeForRegExp(tokyoWhen))),
    ).toBeTruthy();
    expect(screen.queryByText(new RegExp(escapeForRegExp(newYorkWhen)))).toBeNull();
  });

  it('gives the event card an accessible name including the club-timezone time', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'member', display_name: 'Ada', skill_level: null },
    ]);
    fetchUpcomingEvents.mockResolvedValue([EVENT]);
    render(<ClubDetailScreen />);

    const tokyoWhen = formatEventWhen(EVENT.starts_at, 'Asia/Tokyo');
    expect(
      await screen.findByRole('button', {
        name: new RegExp(`Thursday Mahjong, ${escapeForRegExp(tokyoWhen)}`),
      }),
    ).toBeTruthy();
  });

  it('hides the add-game control and the venues link from a plain member', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'member', display_name: 'Ada', skill_level: null },
    ]);
    fetchUpcomingEvents.mockResolvedValue([]);
    render(<ClubDetailScreen />);

    await screen.findByText(/No games scheduled yet\.$/);
    expect(screen.queryByText('Add a game')).toBeNull();
    expect(screen.queryByText('Venues')).toBeNull();
  });

  it('shows the host the add-game control and the venues link', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    fetchUpcomingEvents.mockResolvedValue([]);
    render(<ClubDetailScreen />);

    expect(
      await screen.findByText('No games scheduled yet. Add one and everyone in the club will see it.'),
    ).toBeTruthy();
    expect(screen.getByText('Add a game')).toBeTruthy();
    expect(screen.getByText('Venues')).toBeTruthy();
  });

  // The third line of each card, which nothing asserted before Task 17. It
  // is the only place the club screen reports how big a game is, and it is
  // read straight off the embedded `event_tables` count in
  // `lib/events.ts`'s `toClubEvent` -- a mapper that has already been caught
  // once on this branch going unexercised.
  it('names how many tables each game has, singular and plural', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'member', display_name: 'Ada', skill_level: null },
    ]);
    fetchUpcomingEvents.mockResolvedValue([
      { ...EVENT, table_count: 3 },
      {
        ...EVENT,
        id: 'event-2',
        title: 'Sunday Mahjong',
        starts_at: '2026-09-06T13:00:00.000Z',
        ends_at: '2026-09-06T16:00:00.000Z',
        table_count: 1,
      },
    ]);
    render(<ClubDetailScreen />);

    expect(await screen.findByText('3 tables')).toBeTruthy();
    expect(screen.getByText('1 table')).toBeTruthy();
  });

  it('marks a cancelled event without implying it can still be booked', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    fetchUpcomingEvents.mockResolvedValue([{ ...EVENT, status: 'cancelled' as const }]);
    render(<ClubDetailScreen />);

    expect(await screen.findByText('Cancelled')).toBeTruthy();
  });

  // Seat booking is a later plan, not this one. A member reading the list
  // and tapping through to the event screen is the whole interaction this
  // task builds — no "Book a seat" affordance and no "coming soon" badge
  // should appear anywhere, for an organizer or a member.
  it('offers no booking affordance and no coming-soon badge', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    fetchUpcomingEvents.mockResolvedValue([EVENT]);
    render(<ClubDetailScreen />);

    await screen.findByText('Thursday Mahjong');
    expect(screen.queryByText(/book/i)).toBeNull();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  // The bug this branch's review flagged: `fetchUpcomingEvents` failing
  // alone (club, roster and invites all load fine) used to set the same
  // `loadFailed` flag as the Promise.all above it, so the top-level
  // `if (loadFailed || !club) return <ErrorBanner/>` guard blanked the
  // *entire* screen — a member lost the roster and the invite controls
  // because one list, the games, could not load. Both halves matter: a test
  // that only checked the failure line would still pass on the old code
  // (the whole screen was replaced by an ErrorBanner containing similar
  // text), so this also asserts the roster is still on screen.
  it('degrades only the Upcoming section when the events fetch fails, leaving the roster on screen', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    fetchUpcomingEvents.mockResolvedValue(null);
    render(<ClubDetailScreen />);

    expect(await screen.findByText('Could not load upcoming games.')).toBeTruthy();
    // The rest of the screen is unaffected: club name, roster, and the
    // member count heading all still render.
    expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.getByText('1 member')).toBeTruthy();
    expect(screen.queryByText(/Could not reach MahjHero/)).toBeNull();
  });

  // Task 14: one line per card reporting where the viewer stands. Rendered
  // through the real `eventStatusLine`, not asserted separately from the
  // card — the point is that the screen actually calls it with the event's
  // own bookings/tables, not just that the function works in isolation.
  it('says where you stand on each game, right on the card', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'member', display_name: 'Ada', skill_level: null },
    ]);
    fetchUpcomingEvents.mockResolvedValue([
      {
        ...EVENT,
        event_tables: [{ id: 't1', capacity: 4, label: 'Table 1' }],
        bookings: [
          { profile_id: 'test-user', status: 'confirmed', event_table_id: 't1' },
        ],
      },
    ]);
    render(<ClubDetailScreen />);

    expect(await screen.findByText("You're in · Table 1")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// eventStatusLine — a pure function, tested without rendering. The branching
// is the whole of the behaviour (see lib/events.ts's doc comment on it), and
// a rendering test hides which branch ran, the same reason
// resolveIndexRedirect (app/index.tsx) is tested separately from app/index.tsx
// itself.
//
// `now` is passed explicitly rather than relying on the default `new
// Date()`, matching `needsAFourth`'s own tests in lib/bookings.test.ts —
// leaving it implicit would make the "Needs a 4th" / "48 hours" cases
// dependent on the instant the suite happens to run.
// ---------------------------------------------------------------------------
describe('eventStatusLine', () => {
  const NOW = new Date('2026-08-24T23:00:00Z');
  // Within 48 hours of NOW, for the "Needs a 4th" cases.
  const SOON = '2026-08-25T23:00:00Z';
  // More than 48 hours out, for the case that must NOT read "Needs a 4th"
  // just because a table happens to be exactly one seat short.
  const FAR = '2026-12-01T00:00:00Z';

  // Three of four seats at the one table are taken, and one of them is
  // "me" — a member already in the game does not need recruiting to it.
  const eventOneShort = {
    starts_at: SOON,
    event_tables: [{ id: 't1', capacity: 4 }],
    bookings: [
      { profile_id: 'me', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p2', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p3', status: 'confirmed' as const, event_table_id: 't1' },
    ],
    tables_labels: { t1: 'Table 1' },
  };

  const eventFullWithMeWaiting = {
    starts_at: FAR,
    event_tables: [{ id: 't1', capacity: 4 }],
    bookings: [
      { profile_id: 'p1', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p2', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p3', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p4', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'me', status: 'waitlisted' as const, event_table_id: null },
    ],
  };

  // Two tables, neither one seat short: t1 is completely full, t2 has one
  // booking. 8 total seats, 5 taken, 3 free — a value that discriminates
  // from every other fixture in this block (no accidental tie).
  const eventHalfEmpty = {
    starts_at: FAR,
    event_tables: [
      { id: 't1', capacity: 4 },
      { id: 't2', capacity: 4 },
    ],
    bookings: [
      { profile_id: 'p1', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p2', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p3', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p4', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p5', status: 'confirmed' as const, event_table_id: 't2' },
    ],
  };

  const eventFull = {
    starts_at: FAR,
    event_tables: [{ id: 't1', capacity: 4 }],
    bookings: [
      { profile_id: 'p1', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p2', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p3', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p4', status: 'confirmed' as const, event_table_id: 't1' },
    ],
  };

  const eventWithMyUnseatedBooking = {
    starts_at: FAR,
    event_tables: [{ id: 't1', capacity: 4 }],
    bookings: [
      { profile_id: 'me', status: 'confirmed' as const, event_table_id: null },
    ],
  };

  // One table, one seat short, but the game is more than 48 hours out — the
  // same occupancy as eventOneShort, but this must read the seat count, not
  // "Needs a 4th". Proves the 48-hour window is actually wired through
  // (rather than eventStatusLine reimplementing "one short" without it).
  const eventOneSeatFreeButNotSoon = {
    starts_at: FAR,
    event_tables: [{ id: 't1', capacity: 4 }],
    bookings: [
      { profile_id: 'p1', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p2', status: 'confirmed' as const, event_table_id: 't1' },
      { profile_id: 'p3', status: 'confirmed' as const, event_table_id: 't1' },
    ],
  };

  it('says nothing about a fourth to somebody already playing', () => {
    // Your own state wins over the club's — a member already in the game
    // does not need recruiting to it.
    expect(eventStatusLine(eventOneShort, 'me', NOW)).toBe("You're in · Table 1");
  });

  it('calls for a fourth when you are not in the game', () => {
    expect(eventStatusLine(eventOneShort, 'stranger', NOW)).toBe('Needs a 4th');
  });

  // The embed carries bookings, not groups, so there is no waitlist
  // position here — deliberately. The event screen has event_seating and
  // shows the position there.
  it('says you are waiting, without a position this row cannot know', () => {
    expect(eventStatusLine(eventFullWithMeWaiting, 'me', NOW)).toBe('Waiting');
  });

  it('counts free seats when nothing else applies', () => {
    expect(eventStatusLine(eventHalfEmpty, 'stranger', NOW)).toBe('3 seats free');
  });

  it('uses the singular for exactly one free seat', () => {
    expect(eventStatusLine(eventOneSeatFreeButNotSoon, 'stranger', NOW)).toBe(
      '1 seat free',
    );
  });

  it('says Full rather than "0 seats free"', () => {
    expect(eventStatusLine(eventFull, 'stranger', NOW)).toBe('Full');
  });

  it("says \"You're in\" without a table for an any-table seat", () => {
    expect(eventStatusLine(eventWithMyUnseatedBooking, 'me', NOW)).toBe("You're in");
  });
});
