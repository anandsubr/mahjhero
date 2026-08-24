import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  Link: ({ children }: { children: React.ReactNode }) => children,
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

const CLUB = {
  id: 'club-1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private' as const,
  timezone: 'America/New_York',
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.id = 'club-1';
  fetchClub.mockResolvedValue(CLUB);
  fetchRoster.mockResolvedValue([]);
  fetchPendingInvites.mockResolvedValue([]);
  fetchUpcomingEvents.mockResolvedValue([]);
  importRoster.mockResolvedValue({ created: 2, error: null });
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
