import { useEffect, type ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TabBar, { suitFor, type TabKey } from '../../components/TabBar';
import type { MahjongSuit } from '../../components/MahjongTile';
import { fetchMyClubs } from '../../lib/clubs';
import ClubsScreen from '../clubs/index';
import MessagesScreen from '../messages/index';
import ProfileScreen from '../profile';
import AlertsScreen from '../alerts';

/**
 * The whole point of the fixed glyph-to-section mapping (Club=dots,
 * Messages=bamboo, Profile=中, Alerts=發) is that TabBar and each section's
 * own landing screen agree on it -- and every existing test only asserts
 * THAT a tile renders, never WHICH suit. If two suits were ever swapped --
 * in TabBar.tsx's own `suitFor`, or in a landing screen's own `suit` prop --
 * every existing test would stay green. This file is the one place that
 * would fail.
 *
 * The shared mock setup below is deliberately generous (every screen reaches
 * its own "ready, with a section tile on screen" state) rather than tuned
 * per screen -- the point of these renders is only to read off the `suit`
 * each screen's own MahjongTile carries, not to exercise any of these
 * screens' own behaviour (each already has its own dedicated test file for
 * that).
 */

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/nav-glyph-parity-under-test',
  useLocalSearchParams: () => ({}),
  // Wrapped in a real `useEffect` keyed on the callback's identity -- the
  // same mock every screen's own test file already uses, so `useFocusEffect`
  // fires once on mount rather than on every render.
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(cb, [cb]);
  },
}));

const SESSION = { session: { user: { id: 'me' } }, loading: false };
vi.mock('../../lib/session', () => ({
  useSession: () => SESSION,
}));

vi.mock('../../lib/messages', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/messages')>();
  return {
    ...actual,
    fetchUnreadCounts: vi.fn(async () => []),
    fetchMyThreads: vi.fn(async () => []),
    openThreadForClub: vi.fn(async () => ({ id: null, error: null })),
  };
});

vi.mock('../../lib/use-notifications-unread', () => ({
  useNotificationsUnread: () => 0,
  notifyNotificationsRead: vi.fn(),
}));

vi.mock('../../lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/notifications')>();
  return {
    ...actual,
    fetchMyNotifications: vi.fn(async () => []),
    markNotificationsRead: vi.fn(async () => ({ error: null })),
    fetchNotificationUnreadCount: vi.fn(async () => 0),
  };
});

vi.mock('../../lib/profile', () => ({
  fetchProfile: vi.fn(async () => ({
    id: 'me',
    display_name: 'Pat',
    skill_level: 'intermediate',
    avatar_url: null,
    timezone: 'America/New_York',
  })),
  updateProfile: vi.fn(async () => ({ error: null })),
  isCompleteProfile: () => true,
}));

vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    // `[]` -- the empty-clubs branch -- so ClubsScreen reaches a ready state
    // with its section tile on screen without also needing bookings/events
    // fixtures wired up.
    fetchMyClubs: vi.fn(async () => []),
    fetchMyRoles: vi.fn(async () => []),
  };
});

vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchUpcomingEvents: vi.fn(async () => []),
  };
});

vi.mock('../../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/bookings')>();
  return {
    ...actual,
    fetchMyUpcomingBookings: vi.fn(async () => []),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

// One row per section: TabBar's active key, the expected suit per the plan's
// fixed mapping (hardcoded here, not derived from `suitFor` -- the whole
// point is to catch `suitFor` itself drifting), and the landing screen whose
// own section tile should carry that same suit.
const SECTIONS: { key: TabKey; expectedSuit: MahjongSuit; Screen: ComponentType }[] = [
  { key: 'club', expectedSuit: 'dots', Screen: ClubsScreen },
  { key: 'messages', expectedSuit: 'bamboo', Screen: MessagesScreen },
  { key: 'profile', expectedSuit: 'red-dragon', Screen: ProfileScreen },
  { key: 'alerts', expectedSuit: 'green-dragon', Screen: AlertsScreen },
];

describe('nav glyph parity', () => {
  it.each(SECTIONS)(
    "TabBar's suitFor('$key') and its landing screen's own section tile agree on $expectedSuit",
    async ({ key, expectedSuit, Screen }) => {
      // (a) TabBar's own source of truth.
      expect(suitFor(key)).toBe(expectedSuit);

      // (b) the suit actually rendered by that section's own landing
      // screen -- read off the glyph's own testID (components/MahjongTile.tsx),
      // not duplicated as a second hardcoded list.
      render(<Screen />);
      const tile = await screen.findByTestId('section-tile');
      expect(within(tile).getByTestId(`glyph-${expectedSuit}`)).toBeTruthy();
    },
  );

  // The `club` row above only ever exercises ClubsScreen's EMPTY-clubs
  // branch (`fetchMyClubs` mocked to `[]` for every row, shared setup
  // above) -- a different `<MahjongTile suit="dots" ...>` call site than
  // the screen's own main branch, the one any member with at least one
  // club actually sees (app/clubs/index.tsx, ~line 515). A suit typo there
  // specifically would leave the whole suite -- this file included --
  // green. Overrides `fetchMyClubs` for this one test only, to a single
  // club, matching the minimal fixture clubs.test.tsx's own "dashboard
  // artboard" tests use to reach the same branch.
  it("ClubsScreen's own main (populated) branch also renders the dots suit", async () => {
    vi.mocked(fetchMyClubs).mockResolvedValueOnce([
      {
        id: 'club-1',
        name: 'Riverside Mah Jongg',
        slug: 'riverside',
        rhythm: 'Thursday evenings',
        visibility: 'private',
        timezone: 'America/New_York',
      },
    ]);

    render(<ClubsScreen />);
    const tile = await screen.findByTestId('section-tile');
    expect(within(tile).getByTestId('glyph-dots')).toBeTruthy();
  });

  // Sanity check on the bar itself: renders all four tabs with the same
  // fixed mapping the table above pins, so a reader can see TabBar's actual
  // rendered suits agree with `suitFor` too, not only the pure function.
  it("TabBar renders every tab with suitFor's own mapping", () => {
    render(<TabBar active="club" />);
    for (const { key, expectedSuit } of SECTIONS) {
      const button = screen.getByRole('button', {
        name: new RegExp(`^${key === 'club' ? 'Club' : key[0].toUpperCase() + key.slice(1)}`),
      });
      expect(within(button).getByTestId(`glyph-${expectedSuit}`)).toBeTruthy();
    }
  });
});
