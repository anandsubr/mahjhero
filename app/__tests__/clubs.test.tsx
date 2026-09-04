import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClubsScreen from '../clubs/index';

const push = vi.fn();
const replace = vi.fn();

// Mutable so a test can put `?imported=40` on the URL the way
// `app/clubs/[id]/import.tsx` does after a successful import.
const searchParams: Record<string, string> = { id: 'club-1' };

// TabBar now compares the live route to each tab's own href rather than
// trusting `active` alone, so it needs `usePathname` mocked too. Defaults to
// the clubs list's own route; the club detail describe blocks below switch
// it to `/clubs/club-1`, since that screen renders `active="club"` while
// living at a different URL.
let pathname = '/clubs';

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
  usePathname: () => pathname,
  useLocalSearchParams: () => searchParams,
  // Wrapped in a real `useEffect` keyed on the callback's identity, not
  // called inline on every render: `(cb) => cb()` fires on every render,
  // which the real hook never does, and would refire `useUnreadCounts`'s
  // fetch (now pulled in by TabBar) on every state update it causes.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

// Module-scoped constant, not the fresh object per call this used to be:
// TabBar's badge now reads `useSession` too (via `useUnreadCounts`), and a
// fresh object there breaks the referential stability its
// `useCallback([session])` depends on, refiring the fetch on every render.
const SESSION: { session: { user: { id: string } } | null; loading: boolean } = {
  session: { user: { id: 'test-user' } },
  loading: false,
};
const useSessionMock = vi.fn(() => SESSION);

vi.mock('../../lib/session', () => ({
  useSession: () => useSessionMock(),
}));

const fetchMyClubs = vi.fn();
const fetchClub = vi.fn();
const fetchRoster = vi.fn();
const fetchPendingInvites = vi.fn();
const deleteInvite = vi.fn();
const fetchMyRoles = vi.fn();
const importRoster = vi.fn();
const fetchUpcomingEvents = vi.fn();
const fetchMyUpcomingBookings = vi.fn();
const commitBooking = vi.fn();
const cancelBooking = vi.fn();
const fetchProfile = vi.fn();
const fetchGreetings = vi.fn();

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
    deleteInvite: (...args: unknown[]) => deleteInvite(...args),
    fetchMyRoles: (...args: unknown[]) => fetchMyRoles(...args),
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

// Only fetchGreetings is a network call worth stubbing -- pickDailyGreeting
// and applyGreetingTemplate are pure, already covered directly by
// lib/greetings.test.ts (Task 7), and this test wants them to run for
// real so it is exercising the actual substitution logic, not a second
// hand-rolled copy of it. `vi.importActual` (not a plain object spread
// referencing an outer `import`) is required here: `vi.mock` factories are
// hoisted above every `import` in the file, so a factory that closed over
// a normally-imported binding would run before that import's assignment
// exists. Declaring `fetchGreetings` as a bare `vi.fn()` below works
// because — same as this file's existing `fetchPendingInvites` mock — the
// factory only reads it through a closure at call time, not at hoist time.
vi.mock('../../lib/greetings', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/greetings')>('../../lib/greetings');
  return {
    ...actual,
    fetchGreetings: (...args: unknown[]) => fetchGreetings(...args),
  };
});

const fetchClubLeaderboard = vi.fn();

vi.mock('../../lib/leaderboard', () => ({
  fetchClubLeaderboard: (...args: unknown[]) => fetchClubLeaderboard(...args),
}));

// TabBar (carried by every screen in this file) and, on the dashboard,
// ClubChips both now call `useUnreadCounts`, which reaches `fetchUnreadCounts`.
// `unreadLabel` stays real — UnreadBadge calls it, and it is the pure helper
// covered by lib/messages.test.ts.
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
  pathname = '/clubs';
  fetchClub.mockResolvedValue(CLUB);
  fetchRoster.mockResolvedValue([]);
  fetchPendingInvites.mockResolvedValue([]);
  deleteInvite.mockResolvedValue({ error: null });
  fetchUpcomingEvents.mockResolvedValue([]);
  fetchMyRoles.mockResolvedValue([]);
  importRoster.mockResolvedValue({ created: 2, error: null });
  // Before Task 8 nothing mocked lib/bookings or lib/profile, so every test
  // in this file let the real fetch fail against the placeholder Supabase env
  // and land in the dashboard's `bookingsFailed` branch by accident. These
  // give the whole file a defined starting state instead: a member with no
  // games, no name set, and a booking write that succeeds.
  fetchMyUpcomingBookings.mockResolvedValue([]);
  commitBooking.mockResolvedValue({ result: null, error: null });
  cancelBooking.mockResolvedValue({ error: null });
  fetchProfile.mockResolvedValue({
    id: 'you',
    display_name: 'Anand',
    skill_level: null,
    avatar_url: null,
    timezone: 'America/New_York',
    is_admin: false,
  });
  fetchGreetings.mockResolvedValue([
    { id: 'g1', text: 'Ready to shuffle, {name}?', created_at: '2026-09-01T00:00:00Z' },
  ]);
  fetchClubLeaderboard.mockResolvedValue([]);
});

describe('clubs list', () => {
  it('offers a way to start one when the member has no clubs', async () => {
    fetchMyClubs.mockResolvedValueOnce([]);
    render(<ClubsScreen />);
    expect(await screen.findByText(/not in a club yet/i)).toBeTruthy();
    expect(screen.getByText('Start a club')).toBeTruthy();
  });

  // The early return's whole point: a member in no clubs is shown the one
  // thing they can do, not walked past an empty games list and a chip row to
  // reach it. Exactly one way to start a club — the full-width button — and
  // not also the header's ⊕, which that screen deliberately does not draw.
  it('shows a member in no clubs nothing but the way in', async () => {
    fetchMyClubs.mockResolvedValueOnce([]);
    render(<ClubsScreen />);
    expect(await screen.findByText(/not in a club yet/i)).toBeTruthy();
    expect(screen.queryByText('Your games')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Start a club' })).toHaveLength(1);
  });

  // The club and its rhythm are read off the header now. The chip row draws
  // the same name a second time now (its own tile for this one club, per
  // the "shows the chip row ... for a one-club member" test below), so the
  // name is asserted with findAllByText rather than findByText.
  it('names the one club a member belongs to', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findAllByText('Riverside Mah Jongg')).toHaveLength(2);
    expect(screen.getByText('Thursday evenings')).toBeTruthy();
  });

  it('shows the club as a tile in the combined top row, for the single-club scope', async () => {
    // Reuse whichever existing fixture already reaches the centred
    // "Your club" shape (a one-club member, or a filtered-in club).
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    await screen.findByTestId('thread-avatar-club-tile');
  });

  // "Your games" (Task 13) stacked a whole section below the header and chip
  // row with no `scroll` prop on Screen, unlike every other list screen
  // (app/clubs/[id]/index.tsx, the event screen). A member with a few games
  // could produce a page taller than the viewport with no way to reach the
  // games further down. Both the populated main render and the zero-club
  // early return pass `scroll` now — the loading/ready spinners and the
  // load-failed error banner are the only short, centered, single-purpose
  // content that doesn't need it.
  it('lets the populated screen scroll', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findAllByText('Riverside Mah Jongg')).toHaveLength(2);
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

  // The tile is purely decorative -- scoped to a wrapping testID rather than
  // a bare `[aria-hidden="true"]` query, since TabBar (carried by every
  // screen) already renders one such tile per tab and a bare query would
  // pass whether or not this screen's own section tile exists.
  it('shows a decorative dots tile before the heading when clubs fail to load', async () => {
    fetchMyClubs.mockResolvedValue(null);
    render(<ClubsScreen />);
    await screen.findByText('Your clubs');
    expect(
      screen.getByTestId('section-tile').querySelector('[aria-hidden="true"]'),
    ).toBeTruthy();
  });

  it('shows a decorative dots tile before the heading with no clubs', async () => {
    fetchMyClubs.mockResolvedValue([]);
    render(<ClubsScreen />);
    await screen.findByText('Start a club');
    expect(
      screen.getByTestId('section-tile').querySelector('[aria-hidden="true"]'),
    ).toBeTruthy();
  });
});

describe('dashboard artboard', () => {
  it('leads with the club chips, no header line, when several clubs and none is selected', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([]);

    render(<ClubsScreen />);

    await screen.findByRole('button', { name: /Riverside/ }); // a chip has rendered
    expect(screen.queryByText('Your clubs')).toBeNull();
  });

  it('greets the member by name at the top of the dashboard', async () => {
    // Two clubs, deliberately -- a ONE-club member resolves straight into
    // the "Your club" scope (headerScope, lib/dashboard.ts), which must
    // never show this generic greeting (see the test below). This is the
    // flat "all clubs" scope, the only one the greeting belongs on.
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    fetchProfile.mockResolvedValue({
      id: 'you',
      display_name: 'Anand',
      skill_level: null,
      avatar_url: null,
      timezone: 'America/New_York',
      is_admin: false,
    });
    render(<ClubsScreen />);
    expect(await screen.findByText('Ready to shuffle, Anand?')).toBeTruthy();
  });

  it('shows no greeting line when there are none to show', async () => {
    fetchGreetings.mockResolvedValue([]);
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    await screen.findAllByText('Riverside Mah Jongg');
    expect(screen.queryByText(/Ready to shuffle/)).toBeNull();
  });

  it('shows no greeting line once a single club is in view', async () => {
    // Covers both ways a member lands on the "Your club" scope: a
    // one-club member (headerScope resolves there regardless of
    // `selected`) and a multi-club member who filtered into one.
    fetchMyClubs.mockResolvedValue([CLUB]);
    render(<ClubsScreen />);
    // A one-club member still sees the chip row alongside the centred
    // header (nothing REAL is "filtered in" via `selected`, which stays
    // ALL_CLUBS) -- so the club's name legitimately appears twice.
    await screen.findAllByText('Riverside Mah Jongg');
    expect(screen.queryByText(/Ready to shuffle/)).toBeNull();
  });

  it('drops the greeting the moment a club is filtered in from the "all clubs" scope', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByText('Ready to shuffle, Anand?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Harbour' }));

    await screen.findByRole('button', { name: /^Manage Harbour/ });
    expect(screen.queryByText(/Ready to shuffle/)).toBeNull();
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

  it('shows the game row as club name, time only, and venue — not the event title', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValueOnce([]);
    fetchUpcomingEvents.mockResolvedValueOnce([
      {
        ...EVENT,
        id: 'test',
        club_id: CLUB.id,
        title: 'Test game',
        starts_at: '2027-09-08T23:00:00Z',
        bookings: [
          { profile_id: 'a', status: 'confirmed', event_table_id: 'table-1' },
        ],
      },
    ]);
    render(<ClubsScreen />);
    // The club name and venue are already asserted by neighboring tests
    // using this same fixture — this test's own job is the shape: the
    // event's own title text must be gone, and the time-only label must
    // appear without a repeated date.
    await screen.findByText("Sara's place");
    expect(screen.queryByText('Test game')).toBeNull();
    expect(screen.getByText('7:00 pm')).toBeTruthy();
  });

  it('shows a fee line only when a fee or minimum spend is set', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValueOnce([BOOKING]);
    render(<ClubsScreen />);
    await screen.findAllByText('Riverside Mah Jongg');
    // The default fixture carries no fee — confirmed absent first, so the
    // next case (a fee actually set) is a real contrast, not a tautology.
    expect(screen.queryByText(/to play/)).toBeNull();
    expect(screen.queryByText(/min spend/)).toBeNull();
  });

  it('joins cost-to-play and minimum-spend when both are set on the same game', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...BOOKING, fee_cents: 1500, min_spend_cents: 2000 },
    ]);
    render(<ClubsScreen />);
    expect(
      await screen.findByText('$15 to play · $20 min spend'),
    ).toBeTruthy();
  });

  it('narrows the games list to the picked club', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...BOOKING, event_id: 'e1', club_id: CLUB.id, club_name: CLUB.name, venue_name: 'Riverside hall' },
      { ...BOOKING, booking_id: 'b2', event_id: 'e2', club_id: 'club-2', club_name: 'Harbour', venue_name: 'Harbour hall' },
    ]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    expect(await screen.findByText('Riverside hall')).toBeTruthy();
    expect(screen.getByText('Harbour hall')).toBeTruthy();

    // One "Harbour" button now: the chip. The club's own card in "Your
    // clubs" is gone — the chip row is the whole club list.
    fireEvent.click(screen.getByRole('button', { name: 'Harbour' }));

    expect(screen.queryByText('Riverside hall')).toBeNull();
    expect(screen.getByText('Harbour hall')).toBeTruthy();
    // The header switched to Harbour's own scope. Role-based, not
    // getByText('Harbour') — that text is now ambiguous, since Harbour's
    // own chip tile renders the same label alongside the header.
    expect(screen.getByRole('button', { name: /^Manage Harbour/ })).toBeTruthy();
  });

  it('shows a tappable "Leader" line for the club in view, and navigates to its leaderboard', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchClubLeaderboard.mockResolvedValue([
      { profile_id: 'p1', display_name: 'Ada', total_points: 120, rounds_won: 4 },
    ]);
    render(<ClubsScreen />);

    expect(await screen.findByText('Leader: Ada')).toBeTruthy();
    fireEvent.click(screen.getByText('Leader: Ada'));
    expect(push).toHaveBeenCalledWith(`/clubs/${CLUB.id}/leaderboard`);
  });

  it('shows no Leader line when the club has no recorded rounds', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchClubLeaderboard.mockResolvedValue([]);
    render(<ClubsScreen />);

    await screen.findAllByText('Riverside Mah Jongg');
    expect(screen.queryByText(/^Leader:/)).toBeNull();
  });

  // The all-clubs scope: several clubs, none picked, so the re-derived
  // `clubId` in the Leader effect is null. A non-empty leaderboard is stubbed
  // for the club that WOULD resolve if the effect ignored scope, so this only
  // passes if the line is hidden because of scope -- not because the
  // leaderboard happened to be empty.
  it('shows no Leader line in the all-clubs scope, even with a non-empty leaderboard', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    fetchClubLeaderboard.mockResolvedValue([
      { profile_id: 'p1', display_name: 'Ada', total_points: 120, rounds_won: 4 },
    ]);
    render(<ClubsScreen />);

    await screen.findByRole('button', { name: /Riverside/ }); // a chip has rendered
    expect(screen.queryByText(/^Leader:/)).toBeNull();
  });

  // The chevron is app/clubs/index.tsx's own wiring, not something
  // dashboard-parts.test.tsx's DashboardHeader unit tests can see — this is
  // what proves the screen actually passes onPressBack through, and that
  // pressing it clears `selected` back to ALL_CLUBS rather than just
  // rendering a dead control.
  it('clears the club filter back to all clubs when the chevron is pressed', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);

    expect(await screen.findByRole('button', { name: 'Harbour' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Harbour' }));
    expect(await screen.findByRole('button', { name: /^Manage Harbour/ })).toBeTruthy();
    // The centred "Your club" header draws Harbour's own mahjong tile in its
    // top row (components/DashboardHeader.tsx) -- this is the one place a
    // real "several clubs, tap a chip, see the centred header" flow actually
    // asserts that tile shows up, rather than leaving it covered only
    // piecemeal, across DashboardHeader's own unit tests and
    // nav-glyph-parity.test.tsx's synthetic renders.
    expect(await screen.findByTestId('thread-avatar-club-tile')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear club filter' }));

    expect(await screen.findByRole('button', { name: 'Harbour' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Manage / })).toBeNull();
  });

  // A one-club member's `selected` defaults to ALL_CLUBS and nothing here
  // moves it, so there is nothing for a chevron to clear yet.
  // app/clubs/index.tsx gates onPressBack on `selected !== ALL_CLUBS`, and
  // this is what proves the gate actually holds in the screen, not just in
  // DashboardHeader's own unit tests. See "shows the chip row, with a New
  // club tile, for a one-club member" below for what the row itself does in
  // this same state.
  it('draws no chevron for a one-club member', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findAllByText('Riverside Mah Jongg')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
  });

  // The row now draws for a one-club member too — their own club's tile
  // plus a trailing New club tile, so starting a second club has a route
  // that isn't the header (which no longer offers one at all).
  it('shows the chip row, with a New club tile, for a one-club member', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    expect(await screen.findAllByText('Riverside Mah Jongg')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Riverside Mah Jongg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start a club' })).toBeTruthy();
    expect(screen.getByText('New club')).toBeTruthy();
  });

  it('lets a long club name wrap to a second line instead of truncating', async () => {
    fetchMyClubs.mockResolvedValue([
      { ...CLUB, id: 'c2', name: 'West Chapter Mahjong Society' },
      CLUB,
    ]);
    render(<ClubsScreen />);
    const label = await screen.findByText('West Chapter Mahjong Society');
    // react-native-web renders `numberOfLines` as `-webkit-line-clamp` — 1
    // clips to a single line (what today's bug does); this asserts the fix
    // allows a second line instead. Using getComputedStyle here because
    // this project uses vitest with Chai (not Jest), which lacks toHaveStyle.
    expect(window.getComputedStyle(label).webkitLineClamp).toBe('2');
  });

  it('draws the chip row at two clubs, with a New club tile', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByRole('button', { name: 'Riverside Mah Jongg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Harbour' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start a club' }));
    expect(push).toHaveBeenCalledWith('/clubs/new');
  });

  it('adds a game for the club in view from the header +', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Harbour' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add a game' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-2/events/new');
  });

  it('adds a game for a one-club member’s own club from the header +, with no click needed', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a game' }));
    expect(push).toHaveBeenCalledWith(`/clubs/${CLUB.id}/events/new`);
  });

  // "Start a club" is deliberately not asserted null here: the chip row's
  // own New club tile carries that exact accessible name and is shown
  // whenever nothing is filtered in, at any club count (see "draws the chip
  // row at two clubs, with a New club tile" above) — only the header's own
  // + ("Add a game") is what an ambiguous scope withholds, for want of a
  // single club to add the game to.
  it('offers no header + while every club is in scope', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByRole('button', { name: 'Riverside Mah Jongg' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
  });

  it('hides the chip row once a club is filtered in, and shows it again via the chevron', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByRole('button', { name: 'Harbour' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Harbour' }));
    expect(screen.queryByRole('button', { name: 'Harbour' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start a club' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear club filter' }));
    expect(await screen.findByRole('button', { name: 'Harbour' })).toBeTruthy();
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

    expect(await screen.findByText('Seated · Table 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Join Open game/ })).toBeTruthy();
  });

  // The table used to render apart from the "Seated" tag it describes --
  // first as its own full-width line at the bottom of the card, then as a
  // second line under the tag (misaligned live, per the human's own
  // review). It now lives inside the tag itself, one pill, one message --
  // and is not duplicated by BookingSeatControls' own seat-status line.
  it('folds the table into the Seated pill itself, not a separate line', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([BOOKING]);
    render(<ClubsScreen />);

    expect(await screen.findByText('Seated · Table 1')).toBeTruthy();
    expect(screen.queryByText('Seated')).toBeNull();
    expect(screen.queryByText('Table 1')).toBeNull();
  });

  // Confirmed live: a booking can be confirmed before a physical table is
  // assigned, and the row's "Seated" tag (GameRow, keyed only on
  // booking.status) showed at the same time a separate line said "Not
  // seated yet" -- a direct contradiction on the same card. Folded into
  // the same pill as the table label, the same way "Seated · Table 1"
  // already is, rather than a second line that can drift from the tag.
  it('folds "no table yet" into the same Seated pill, not a separate line', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([
      { ...BOOKING, event_table_id: null, table_label: null },
    ]);
    render(<ClubsScreen />);

    expect(await screen.findByText('Seated · No table')).toBeTruthy();
    expect(screen.queryByText('Not seated yet')).toBeNull();
    expect(screen.queryByText('Table not assigned yet')).toBeNull();
  });

  it('shows the dashed empty state when nothing is coming up', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyUpcomingBookings.mockResolvedValue([]);
    fetchUpcomingEvents.mockResolvedValue([]);
    fetchProfile.mockResolvedValue(null);

    render(<ClubsScreen />);

    expect(await screen.findByText('Nothing else coming up.')).toBeTruthy();
  });

  // Gated on `scopeClubId`, not `selected !== ALL_CLUBS`: nothing forces a
  // one-club member to tap their own chip tile, so their `selected` typically
  // stays ALL_CLUBS regardless of what the chip row itself renders. Gating on
  // `selected` alone would therefore still hide "Host a table" from exactly
  // the member most likely to want it: their empty state was a dashed box and
  // nothing else. The test above seeds this same state and asserts only the
  // copy, which is how it passed straight over the gap.
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

  // The write above closed the write-vs-write race, but `setBusy(false)` ran
  // right after the write's own await and before `await
  // reloadAfterBooking()` — and `reloadAfterBooking` is the half that
  // actually writes `events` and `bookings`. So a decline's reload could
  // still land after a later join's and overwrite it with a snapshot taken
  // before the join existed. This test holds the *reload* open instead of
  // the write: the write resolves normally, and it's the first
  // `fetchMyUpcomingBookings` call that follows it — the reload's own read —
  // that stays in flight for the assertion.
  it('locks the other booking actions while a reload is in flight', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    fetchMyClubs.mockResolvedValue([CLUB]);
    const heldBooking = {
      ...BOOKING,
      event_id: 'held',
      starts_at: soon,
      event_title: 'Held game',
      status: 'waitlisted' as const,
      event_table_id: null,
      table_label: null,
      waitlist_position: 2,
    };
    // The mount effect's own read gets the initial fixture; the second call
    // — the reload `runBookingAction` fires after the join succeeds — is the
    // one held open, so a controlled promise rather than a resolved value.
    let releaseReload: (value: (typeof heldBooking)[]) => void = () => {};
    fetchMyUpcomingBookings
      .mockResolvedValueOnce([heldBooking])
      .mockReturnValueOnce(
        new Promise((resolve) => {
          releaseReload = resolve;
        }),
      );
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

    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Join Open game/ }));

    // Wait until the reload's own read has actually been issued — i.e. the
    // write has resolved and `reloadAfterBooking` is under way — before
    // asserting anything. Asserting right after the click would pass
    // trivially either way: `setBusy(true)` is synchronous on the click, so
    // `waitFor`'s very first (immediate) check would already see the control
    // disabled regardless of this bug, and `waitFor` doesn't keep watching
    // once it has passed once. Only checking once the write is done and the
    // reload is the one thing left in flight tells the two behaviours apart.
    await waitFor(() => expect(fetchMyUpcomingBookings).toHaveBeenCalledTimes(2));

    expect(
      screen.getByLabelText('Leave the waitlist for Held game').getAttribute('aria-disabled'),
    ).toBe('true');

    releaseReload([heldBooking]);
  });

  it('opens the club from the header when one club is in scope', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Manage Riverside Mah Jongg, Thursday evenings' }),
    );
    expect(push).toHaveBeenCalledWith('/clubs/club-1');
  });

  // "All clubs" is not a club. Offering a way in from the header there would
  // have to guess which one the member meant.
  it('offers no way in while every club is in scope', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    expect(await screen.findByRole('button', { name: 'Riverside Mah Jongg' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Manage / })).toBeNull();
  });

  it('opens the club the chips picked', async () => {
    fetchMyClubs.mockResolvedValue([CLUB, { ...CLUB, id: 'club-2', name: 'Harbour' }]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Harbour' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage Harbour, Thursday evenings' }));
    expect(push).toHaveBeenCalledWith('/clubs/club-2');
  });

  // The header no longer offers a way to start a club at all — that's the
  // chip row's New club tile now, which draws even for a one-club member.
  it('keeps a way to start another club at one club, via the New club tile', async () => {
    fetchMyClubs.mockResolvedValueOnce([CLUB]);
    render(<ClubsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start a club' }));
    expect(push).toHaveBeenCalledWith('/clubs/new');
  });
});

describe('organizing an unbooked, in-progress game', () => {
  // Relative to the real clock, matching EVENT's own convention in this
  // file (fake timers are deliberately not installed here) -- a fixed
  // calendar timestamp would silently stop being "in progress" the moment
  // it passed.
  const inProgressStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const inProgressEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  function liveUnbookedGame() {
    return {
      ...EVENT,
      id: 'live-game',
      club_id: CLUB.id,
      title: 'In progress now',
      starts_at: inProgressStart,
      ends_at: inProgressEnd,
    };
  }

  it("shows a Hosting tag and no Join button for the organizer's own unbooked, in-progress game", async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyRoles.mockResolvedValue([{ club_id: CLUB.id, role: 'host' }]);
    fetchUpcomingEvents.mockResolvedValue([liveUnbookedGame()]);

    render(<ClubsScreen />);

    expect(await screen.findByText("Sara's place")).toBeTruthy();
    expect(screen.getByText('Hosting')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Join/ })).toBeNull();
  });

  it('does not show an in-progress unbooked game to a plain member', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyRoles.mockResolvedValue([{ club_id: CLUB.id, role: 'member' }]);
    fetchUpcomingEvents.mockResolvedValue([liveUnbookedGame()]);

    render(<ClubsScreen />);

    expect(await screen.findByRole('button', { name: 'Club' })).toBeTruthy();
    expect(screen.queryByText("Sara's place")).toBeNull();
  });

  it('opens the event screen when the organizing row is tapped', async () => {
    fetchMyClubs.mockResolvedValue([CLUB]);
    fetchMyRoles.mockResolvedValue([{ club_id: CLUB.id, role: 'host' }]);
    fetchUpcomingEvents.mockResolvedValue([liveUnbookedGame()]);

    render(<ClubsScreen />);

    const link = (await screen.findByText("Sara's place")).closest('a');
    expect(link?.getAttribute('data-href')).toBe(
      `/clubs/${CLUB.id}/events/live-game`,
    );
  });
});

import ImportRosterScreen from '../clubs/[id]/import';

describe('roster import', () => {
  // This screen's own route is /clubs/club-1/import, not the Club tab's own
  // /clubs -- same distinction the club detail and venues describe blocks
  // draw for their own routes.
  beforeEach(() => {
    pathname = '/clubs/club-1/import';
  });

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

  // TabBar navigates with router.replace off an entry route that is itself
  // a Redirect, so the history stack is typically one deep -- a state
  // without the bar strands a host with no way out but relaunching the app.
  // See clubs.test.tsx's other describe blocks for the identical rationale.
  describe('screen chrome', () => {
    it('carries the tab bar', async () => {
      render(<ImportRosterScreen />);
      expect(await screen.findByRole('button', { name: 'Club' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
    });

    it('carries the tab bar while the session is still loading', () => {
      useSessionMock.mockReturnValueOnce({ session: null, loading: true });
      render(<ImportRosterScreen />);
      expect(screen.getByRole('button', { name: 'Club' })).toBeTruthy();
    });

    // Goes to /clubs/club-1, a specific club -- a different destination
    // from the Club tab's own /clubs -- so it stays, the same reasoning
    // venues.test.tsx's "Back to the club" documents for itself.
    it('keeps its back link to the club, a different destination from the Club tab', async () => {
      render(<ImportRosterScreen />);
      fireEvent.click(await screen.findByRole('button', { name: 'Back to the club' }));
      expect(push).toHaveBeenCalledWith('/clubs/club-1');
    });
  });
});

import ClubDetailScreen from '../clubs/[id]/index';
import { eventStatusLine } from '../../lib/events';

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
  // This screen's own route is /clubs/[id], not the Club tab's own /clubs —
  // it renders `active="club"` purely to keep the bar highlighting Club as
  // a section, not because /clubs/club-1 and /clubs are the same place. See
  // the 'carries the tab bar' tests below for why that distinction matters.
  beforeEach(() => {
    pathname = '/clubs/club-1';
  });

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

  // Once created, the link had nowhere left to go: not shown again, no way
  // to resend it, no way to revoke it short of the 30-day expiry.
  it('copies a pending invite\'s link to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    fetchPendingInvites.mockResolvedValue([
      { id: 'i1', email: 'jane@example.com', display_name: 'Jane Doe', skill_level: null, token: 'tok-1' },
    ]);
    render(<ClubDetailScreen />);

    fireEvent.click(await screen.findByLabelText('Copy the invite link for Jane Doe'));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/join/tok-1')),
    );
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('deletes a pending invite', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    fetchPendingInvites.mockResolvedValue([
      { id: 'i1', email: 'jane@example.com', display_name: 'Jane Doe', skill_level: null, token: 'tok-1' },
    ]);
    render(<ClubDetailScreen />);

    fireEvent.click(await screen.findByLabelText('Delete the invite for Jane Doe'));

    expect(deleteInvite).toHaveBeenCalledWith('i1');
    await waitFor(() => expect(screen.queryByText('Jane Doe')).toBeNull());
  });

  it('keeps a pending invite on screen and shows an error when the delete fails', async () => {
    deleteInvite.mockResolvedValue({ error: 'Something went wrong.' });
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    fetchPendingInvites.mockResolvedValue([
      { id: 'i1', email: 'jane@example.com', display_name: 'Jane Doe', skill_level: null, token: 'tok-1' },
    ]);
    render(<ClubDetailScreen />);

    fireEvent.click(await screen.findByLabelText('Delete the invite for Jane Doe'));

    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
    expect(screen.getByText('Jane Doe')).toBeTruthy();
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

  it('filters the roster by name as the host types', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
      { profile_id: 'user-2', role: 'member', display_name: 'Ben', skill_level: null },
    ]);
    render(<ClubDetailScreen />);
    await screen.findByText('Ada');

    fireEvent.change(screen.getByLabelText('Search members'), {
      target: { value: 'ad' },
    });

    expect(screen.getByText('Ada')).toBeTruthy();
    expect(screen.queryByText('Ben')).toBeNull();
  });

  it('finds a member with no display name by searching "member"', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: '', skill_level: null },
      { profile_id: 'user-2', role: 'member', display_name: 'Ben', skill_level: null },
    ]);
    render(<ClubDetailScreen />);
    await screen.findByText('Ben');

    fireEvent.change(screen.getByLabelText('Search members'), {
      target: { value: 'member' },
    });

    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.queryByText('Ben')).toBeNull();
  });

  it('tells the host when nobody matches their search, without hiding the search field', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    render(<ClubDetailScreen />);
    await screen.findByText('Ada');

    fireEvent.change(screen.getByLabelText('Search members'), {
      target: { value: 'zzz' },
    });

    expect(screen.queryByText('Ada')).toBeNull();
    expect(screen.getByText('No members match "zzz".')).toBeTruthy();
    expect(screen.getByLabelText('Search members')).toBeTruthy();
  });

  // This button used to push to a compose screen that emailed the whole
  // roster; it now opens an in-app thread with the "Also email everyone"
  // toggle off by default. "Message members" was left over from the old
  // behaviour, and an organizer's muscle memory would read it as "this
  // emails the club" — which it no longer does.
  it('offers to open the club thread, not the old email-flavoured label', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null },
    ]);
    render(<ClubDetailScreen />);
    expect(
      await screen.findByRole('button', { name: 'Open the club thread' }),
    ).toBeTruthy();
    expect(screen.queryByText('Message members')).toBeNull();
  });

  // TabBar navigates with router.replace off an entry route that is itself a
  // Redirect, so the history stack is typically one deep. A club screen with
  // no bar and (below) no back button would be a dead end on native.
  it('carries the tab bar', async () => {
    render(<ClubDetailScreen />);
    expect(await screen.findByRole('button', { name: 'Club' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
  });

  // The regression the tests above never caught: they only assert the Club
  // button renders, which it did even while pressing it was a dead end. This
  // screen renders `active="club"` at route /clubs/club-1, not TabBar's own
  // /clubs, so a member's most natural way back to the dashboard — tap a
  // game on the dashboard, then Back, landing here — met a highlighted Club
  // button that fired neither `push` nor `replace`. It has to actually
  // navigate, not just be present.
  it('navigates to the dashboard when Club is pressed', async () => {
    render(<ClubDetailScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Club' }));
    expect(replace).toHaveBeenCalledWith('/clubs');
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

  it('names the club in the dashboard header', async () => {
    render(<ClubDetailScreen />);
    expect(await screen.findByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Thursday evenings')).toBeTruthy();
    // Pins this to the "Your club" tile variant specifically — the name and
    // rhythm text alone would pass identically for the flat branch, so they
    // don't prove which shape actually rendered.
    expect(screen.getByTestId('thread-avatar-club-tile')).toBeTruthy();
    // The bottom tab bar's own Profile tab is the way to profile now —
    // this header no longer draws its own avatar/profile control.
    expect(screen.queryByRole('button', { name: 'Your profile' })).toBeNull();
  });

  // The separate "← Clubs" ghost button is gone — DashboardHeader's own
  // chevron slot (previously always empty on this screen, since it never
  // passed onPressBack) now carries the back action, so there is exactly
  // one way back, not two.
  it('shows the club as a tile, with one consolidated back button', async () => {
    render(<ClubDetailScreen />);
    expect(await screen.findByTestId('thread-avatar-club-tile')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: 'Back to your clubs' }),
    ).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Clear club filter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a game' })).toBeNull();
  });

  // The tab bar's Club tab reaches the identical /clubs route, but renders
  // as *already active* on this screen — which reads as "you are here",
  // not "go back" — so this screen carries its own explicit back link
  // (2026-09-01-back-links-design.md).
  it('draws a back link to the dashboard', async () => {
    render(<ClubDetailScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to your clubs' }));
    expect(push).toHaveBeenCalledWith('/clubs');
  });

  // The leaderboard screen (app/clubs/[id]/leaderboard.tsx) is a standings
  // view, not an organizer tool -- unlike "Open the club thread" and the
  // rest of the `mayInvite`-gated row, every member should be able to reach
  // it from here, not just hosts/co-organizers.
  it('shows a Leaderboard button to every member, not just organizers', async () => {
    fetchRoster.mockResolvedValue([
      { profile_id: 'test-user', role: 'member', display_name: 'Ada', skill_level: null },
    ]);
    render(<ClubDetailScreen />);

    const button = await screen.findByRole('button', { name: 'Leaderboard' });
    fireEvent.click(button);
    expect(push).toHaveBeenCalledWith('/clubs/club-1/leaderboard');
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
