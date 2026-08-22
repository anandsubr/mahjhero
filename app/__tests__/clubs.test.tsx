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
import { formatEventWhen } from '../../lib/events';

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
});
