import { useEffect, type ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Linking, Platform } from 'react-native';
import type { MyGame } from '../../lib/my-games';
import type { Club, ClubRole } from '../../lib/clubs';

const push = vi.fn();
const useFocusEffectSpy = vi.fn();

vi.mock('expo-router', () => ({
  useRouter: () => ({ push, back: vi.fn(), replace: vi.fn() }),
  useLocalSearchParams: () => ({ id: 'c1' }),
  // Identity-keyed, like app/__tests__/club-board.test.tsx: fires on mount
  // and whenever the callback changes, never on every render.
  useFocusEffect: (cb: () => void) => {
    useFocusEffectSpy(cb);
    useEffect(cb, [cb]);
  },
}));

const fetchClubGames = vi.fn();
vi.mock('../../lib/my-games', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/my-games')>();
  return { ...actual, fetchClubGames: (...a: unknown[]) => fetchClubGames(...a) };
});

const getMyCalendarFeedUrl = vi.fn();
vi.mock('../../lib/calendar-feed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/calendar-feed')>();
  return { ...actual, getMyCalendarFeedUrl: () => getMyCalendarFeedUrl() };
});

import GamesSection from '../clubs/[id]/(hub)/games';
import { ClubHubContext } from '../../components/hub/ClubHubContext';

const CLUB: Club = {
  id: 'c1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: '',
  visibility: 'private',
  timezone: 'America/New_York',
  default_game_mode: 'open_play',
  code: 'RIVER24',
  cover_path: null,
  cover_color: 'accent2_800',
};

const DAY = 86_400_000;

function game(overrides: Partial<MyGame>): MyGame {
  return {
    eventId: 'e1',
    clubId: 'c1',
    clubName: 'Riverside Mah Jongg',
    title: 'Strategy night',
    gameMode: 'open_play',
    seatingMode: 'open_seating',
    startsAt: new Date(Date.now() + 2 * DAY).toISOString(),
    timezone: 'America/New_York',
    venueName: 'Sample Venue',
    seatsTaken: 5,
    capacity: 8,
    myStatus: 'not',
    waitlistPosition: null,
    tableLabel: null,
    ...overrides,
  };
}

const FEED_URL = 'https://proj.supabase.co/functions/v1/calendar-feed?token=abc';

function renderSection(role: ClubRole | null = 'member'): ReactElement {
  const ui = (
    <ClubHubContext.Provider value={{ club: CLUB, role, reloadClub: vi.fn() }}>
      <GamesSection />
    </ClubHubContext.Provider>
  );
  render(ui);
  return ui;
}

function windowOf(call: unknown[]): { from: number; to: number } {
  return { from: (call[1] as Date).getTime(), to: (call[2] as Date).getTime() };
}

const originalOS = Platform.OS;
function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchClubGames.mockResolvedValue([]);
  getMyCalendarFeedUrl.mockResolvedValue(FEED_URL);
});

afterEach(() => {
  setOS(originalOS);
});

describe('club Games section', () => {
  it('defaults to Upcoming, fetching the next 120 days, and lists rows with their notes', async () => {
    fetchClubGames.mockResolvedValue([
      game({ eventId: 'e1', title: 'Strategy night', notes: 'Bring a card' }),
    ]);
    renderSection();
    expect(await screen.findByText('Strategy night')).toBeTruthy();
    expect(screen.getByText('Bring a card')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Upcoming' }).getAttribute('aria-selected')).toBe('true');

    const [call] = fetchClubGames.mock.calls;
    expect(call[0]).toBe('c1');
    const { from, to } = windowOf(call);
    expect(Math.abs(from - Date.now())).toBeLessThan(5_000);
    expect(Math.round((to - from) / DAY)).toBe(120);
  });

  it('opens the game a row names, in this club', async () => {
    fetchClubGames.mockResolvedValue([game({ eventId: 'e9', title: 'Beginner table' })]);
    renderSection();
    fireEvent.click(await screen.findByLabelText(/Open Beginner table/));
    expect(push).toHaveBeenCalledWith('/clubs/c1/events/e9');
  });

  it('shows the Invited tag', async () => {
    fetchClubGames.mockResolvedValue([game({ myStatus: 'invited' })]);
    renderSection();
    expect(await screen.findByText('Invited')).toBeTruthy();
  });

  it('Past fetches the last 180 days, newest first, and says so when empty', async () => {
    renderSection();
    await waitFor(() => expect(fetchClubGames).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Past' }));
    expect(await screen.findByText('No past games.')).toBeTruthy();

    const { from, to } = windowOf(fetchClubGames.mock.calls[1]);
    expect(Math.abs(to - Date.now())).toBeLessThan(5_000);
    expect(Math.round((to - from) / DAY)).toBe(180);
  });

  it('lists past games newest first', async () => {
    fetchClubGames.mockResolvedValue([]);
    renderSection();
    await waitFor(() => expect(fetchClubGames).toHaveBeenCalledTimes(1));
    fetchClubGames.mockResolvedValue([
      game({ eventId: 'old', title: 'Older game', startsAt: new Date(Date.now() - 20 * DAY).toISOString() }),
      game({ eventId: 'new', title: 'Newer game', startsAt: new Date(Date.now() - 2 * DAY).toISOString() }),
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'Past' }));
    await screen.findByText('Newer game');
    const rows = screen.getAllByLabelText(/^Open /).map((el) => el.getAttribute('aria-label'));
    expect(rows[0]).toMatch(/Newer game/);
    expect(rows[1]).toMatch(/Older game/);
  });

  it('All spans past and upcoming in one ascending list', async () => {
    renderSection();
    await waitFor(() => expect(fetchClubGames).toHaveBeenCalledTimes(1));
    fetchClubGames.mockResolvedValue([
      game({ eventId: 'p', title: 'Last week', startsAt: new Date(Date.now() - 7 * DAY).toISOString() }),
      game({ eventId: 'u', title: 'Next week', startsAt: new Date(Date.now() + 7 * DAY).toISOString() }),
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    await screen.findByText('Next week');
    const { from, to } = windowOf(fetchClubGames.mock.calls[1]);
    expect(Math.round((Date.now() - from) / DAY)).toBe(180);
    expect(Math.round((to - Date.now()) / DAY)).toBe(120);
    const rows = screen.getAllByLabelText(/^Open /).map((el) => el.getAttribute('aria-label'));
    expect(rows[0]).toMatch(/Last week/);
    expect(rows[1]).toMatch(/Next week/);
  });

  it('keeps only the newest segment when switching quickly', async () => {
    let resolveUpcoming: (v: MyGame[]) => void = () => {};
    fetchClubGames.mockReturnValueOnce(new Promise<MyGame[]>((r) => { resolveUpcoming = r; }));
    fetchClubGames.mockResolvedValueOnce([]);
    renderSection();
    fireEvent.click(screen.getByRole('tab', { name: 'Past' }));
    expect(await screen.findByText('No past games.')).toBeTruthy();
    await act(async () => {
      resolveUpcoming([game({ title: 'Stale upcoming' })]);
      await Promise.resolve();
    });
    expect(screen.queryByText('Stale upcoming')).toBeNull();
    expect(screen.getByText('No past games.')).toBeTruthy();
  });

  it('refetches on refocus', async () => {
    renderSection();
    await waitFor(() => expect(fetchClubGames).toHaveBeenCalledTimes(1));
    const callbacks = Array.from(
      new Set(useFocusEffectSpy.mock.calls.map((c) => c[0] as () => void)),
    );
    await act(async () => {
      callbacks.forEach((cb) => cb());
      await Promise.resolve();
    });
    expect(fetchClubGames).toHaveBeenCalledTimes(2);
  });

  it('reports a failed load with Retry, not as an empty list', async () => {
    fetchClubGames.mockResolvedValueOnce(null);
    renderSection();
    expect(await screen.findByText('Could not load games.')).toBeTruthy();
    expect(screen.queryByText('No games here yet.')).toBeNull();
    fetchClubGames.mockResolvedValueOnce([game({ title: 'Back again' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Back again')).toBeTruthy();
    expect(screen.queryByText('Could not load games.')).toBeNull();
  });

  describe('empty state and New game', () => {
    it('members see the empty copy and no New game', async () => {
      renderSection('member');
      expect(await screen.findByText('No games here yet.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'New game' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Add to calendar' })).toBeTruthy();
    });

    it('co-organizers do not get New game either (creation is host-only)', async () => {
      renderSection('co_organizer');
      await screen.findByText('No games here yet.');
      expect(screen.queryByRole('button', { name: 'New game' })).toBeNull();
    });

    it('hosts get New game in the footer, opening the new-game screen', async () => {
      fetchClubGames.mockResolvedValue([game({})]);
      renderSection('host');
      await screen.findByText('Strategy night');
      const buttons = screen.getAllByRole('button', { name: 'New game' });
      expect(buttons).toHaveLength(1);
      fireEvent.click(buttons[0]);
      expect(push).toHaveBeenCalledWith('/clubs/c1/events/new');
    });

    it('hosts also get New game under the empty state', async () => {
      renderSection('host');
      await screen.findByText('No games here yet.');
      expect(screen.getAllByRole('button', { name: 'New game' })).toHaveLength(2);
    });
  });

  describe('Add to calendar', () => {
    it('on web opens the sheet with the https link and copies it', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
      const sheet = await screen.findByTestId('calendar-link-sheet');
      expect(within(sheet).getByText(FEED_URL)).toBeTruthy();
      expect(
        within(sheet).getByText('Add it in your calendar app under ‘Subscribe to calendar’.'),
      ).toBeTruthy();
      fireEvent.click(within(sheet).getByRole('button', { name: 'Copy link' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(FEED_URL));
      expect(await within(sheet).findByText('Copied')).toBeTruthy();
      expect(within(sheet).getByRole('button', { name: 'Copied' })).toBeTruthy();
      expect(within(sheet).getByRole('heading', { name: 'Add to calendar' })).toBeTruthy();
      // Only the ✕ is announced as Close; the scrim is hidden.
      expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
      expect(screen.getByTestId('calendar-link-scrim').getAttribute('aria-hidden')).toBe('true');
    });

    it('fetches the link once when Add to calendar is tapped twice quickly', async () => {
      renderSection();
      const button = await screen.findByRole('button', { name: 'Add to calendar' });
      fireEvent.click(button);
      fireEvent.click(button);
      await screen.findByTestId('calendar-link-sheet');
      expect(getMyCalendarFeedUrl).toHaveBeenCalledTimes(1);
    });

    it('marks the segments as tabs with the selected one', async () => {
      renderSection();
      expect(screen.getByRole('tablist')).toBeTruthy();
      expect(screen.getAllByRole('tab')).toHaveLength(3);
      expect(screen.getByRole('tab', { name: 'Upcoming' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('tab', { name: 'Past' }).getAttribute('aria-selected')).toBe('false');
      await waitFor(() => expect(fetchClubGames).toHaveBeenCalled());
    });

    it('on web survives an unavailable clipboard, leaving the link on screen', async () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
      const sheet = await screen.findByTestId('calendar-link-sheet');
      fireEvent.click(within(sheet).getByRole('button', { name: 'Copy link' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(within(sheet).getByText(FEED_URL)).toBeTruthy();
      expect(within(sheet).queryByText('Copied')).toBeNull();
    });

    it('shows an inline error when the link cannot be fetched', async () => {
      getMyCalendarFeedUrl.mockResolvedValue(null);
      renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
      expect(await screen.findByText('Could not get your calendar link.')).toBeTruthy();
      expect(screen.queryByTestId('calendar-link-sheet')).toBeNull();
    });

    it('on native subscribes via webcal://, with no sheet', async () => {
      setOS('ios');
      const open = vi.spyOn(Linking, 'openURL').mockResolvedValue(true);
      renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
      await waitFor(() =>
        expect(open).toHaveBeenCalledWith('webcal://proj.supabase.co/functions/v1/calendar-feed?token=abc'),
      );
      expect(screen.queryByTestId('calendar-link-sheet')).toBeNull();
      open.mockRestore();
    });

    it('on native falls back to the sheet (with Share link) when webcal cannot open', async () => {
      setOS('ios');
      const open = vi.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
      renderSection();
      fireEvent.click(await screen.findByRole('button', { name: 'Add to calendar' }));
      const sheet = await screen.findByTestId('calendar-link-sheet');
      expect(within(sheet).getByRole('button', { name: 'Share link' })).toBeTruthy();
      expect(within(sheet).queryByRole('button', { name: 'Copy link' })).toBeNull();
      open.mockRestore();
    });
  });
});
