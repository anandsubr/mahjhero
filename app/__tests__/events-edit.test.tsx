import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1', eventId: 'event-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push, replace, back }),
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

const fetchClub = vi.fn();

vi.mock('../../lib/clubs', () => ({
  fetchClub: (...args: unknown[]) => fetchClub(...args),
}));

const fetchEvent = vi.fn();
const fetchSeries = vi.fn();
const fetchOverriddenOccurrences = vi.fn();
const fetchFutureOccurrenceCount = vi.fn();
const updateEvent = vi.fn();
const updateEventSeries = vi.fn();
const endEventSeries = vi.fn();

// formatEventWhen, frequencyLabel and eventStartTimeInZone stay real (pure) —
// the point of several tests below is to exercise the real Intl formatting,
// matching events-new.test.tsx's and events-detail.test.tsx's convention.
vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    fetchEvent: (...args: unknown[]) => fetchEvent(...args),
    fetchSeries: (...args: unknown[]) => fetchSeries(...args),
    fetchOverriddenOccurrences: (...args: unknown[]) => fetchOverriddenOccurrences(...args),
    fetchFutureOccurrenceCount: (...args: unknown[]) => fetchFutureOccurrenceCount(...args),
    updateEvent: (...args: unknown[]) => updateEvent(...args),
    updateEventSeries: (...args: unknown[]) => updateEventSeries(...args),
    endEventSeries: (...args: unknown[]) => endEventSeries(...args),
  };
});

// VenuePicker does its own venue search over lib/venues/supabase, irrelevant
// to this screen's own logic. Stubbed to a single button reporting a FIXED
// venue distinct from every fixture's own venue_id below, so "the host
// changed the venue" is unambiguous whenever this stub is clicked, and
// unambiguously untouched whenever it is not — matching
// events-new.test.tsx's pickVenue() pattern.
vi.mock('../../components/VenuePicker', () => ({
  default: ({ onChange }: { onChange: (id: string, name: string) => void }) => (
    <button onClick={() => onChange('venue-2', 'New Venue')}>
      Pick venue (test stub)
    </button>
  ),
}));

import EditEventScreen from '../clubs/[id]/events/[eventId]/edit';

// Deliberately NOT America/New_York, the value TZ is pinned to for the whole
// suite (package.json's `test` script) — same technique
// app/__tests__/events-detail.test.tsx uses, so a screen that silently fell
// back to the device zone would shift every clock value asserted below.
const CLUB = {
  id: 'club-1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private' as const,
  timezone: 'Asia/Tokyo',
};

// 2026-09-03T10:00:00Z is 19:00 JST (UTC+9, no DST).
const ONE_OFF_EVENT = {
  id: 'event-1',
  club_id: 'club-1',
  series_id: null as string | null,
  title: 'Thursday Mahjong',
  venue_id: 'venue-1',
  venue_name: 'The Annexe',
  notes: '',
  starts_at: '2026-09-03T10:00:00.000Z',
  ends_at: '2026-09-03T13:00:00.000Z',
  status: 'published' as const,
  occurrence_date: null as string | null,
  overrides: [] as string[],
  table_count: 1,
};

const SERIES_EVENT = {
  ...ONE_OFF_EVENT,
  id: 'event-2',
  series_id: 'series-1' as string | null,
  occurrence_date: '2026-09-03',
};

const SERIES = {
  id: 'series-1',
  club_id: 'club-1',
  title: 'Thursday Mahjong',
  venue_id: 'venue-1',
  notes: '',
  frequency: 'weekly' as const,
  weekday: 4,
  nth_week: null as number | null,
  start_time: '19:00:00',
  duration_minutes: 180,
  table_count: 1,
  starts_on: '2026-01-01',
  ends_on: '2026-12-31' as string | null,
  ended_at: null as string | null,
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(searchParams)) delete searchParams[key];
  searchParams.id = 'club-1';
  searchParams.eventId = 'event-1';
  useSessionMock.mockReturnValue({
    session: { user: { id: 'test-user' } },
    loading: false,
  });
  fetchClub.mockResolvedValue(CLUB);
  fetchEvent.mockResolvedValue(ONE_OFF_EVENT);
  fetchSeries.mockResolvedValue(null);
  fetchOverriddenOccurrences.mockResolvedValue([]);
  fetchFutureOccurrenceCount.mockResolvedValue(0);
  updateEvent.mockResolvedValue({ error: null });
  updateEventSeries.mockResolvedValue({ error: null });
  endEventSeries.mockResolvedValue({ error: null });
});

// A guard-ordering regression this branch has hit repeatedly (the club
// detail screen, app/index.tsx's storage race, and this task's own brief —
// its Step 1 sample code put `!ready` before `!session`): `ready` is only
// ever set inside an effect gated on a signed-in session, so a signed-out
// visitor can never make it true, and checking `!ready` first strands them
// on a spinner instead of sending them to sign in.
describe('guard ordering', () => {
  it('redirects to sign-in instead of spinning forever when signed out', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<EditEventScreen />);
    const redirect = await screen.findByTestId('redirect');
    expect(redirect.getAttribute('data-href')).toBe('/sign-in');
    expect(fetchEvent).not.toHaveBeenCalled();
  });
});

describe('a one-off event', () => {
  it('shows no scope choice at all', async () => {
    render(<EditEventScreen />);
    await screen.findByDisplayValue('Thursday Mahjong');
    expect(screen.queryByText('This game')).toBeNull();
    expect(screen.queryByText('The whole series')).toBeNull();
    expect(screen.queryByText('Change the schedule')).toBeNull();
  });

  it('sends null for every field the host did not touch, and only the one they did', async () => {
    render(<EditEventScreen />);
    await screen.findByDisplayValue('Thursday Mahjong');

    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Friday Mahjong' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEvent).toHaveBeenCalledWith('event-1', {
      title: 'Friday Mahjong',
      venueId: null,
      notes: null,
      startTime: null,
    });
    expect(replace).toHaveBeenCalledWith('/clubs/club-1/events/event-1');
  });

  it('sends every field null when the host saves without changing anything', async () => {
    render(<EditEventScreen />);
    await screen.findByDisplayValue('Thursday Mahjong');
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEvent).toHaveBeenCalledWith('event-1', {
      title: null,
      venueId: null,
      notes: null,
      startTime: null,
    });
  });

  it('sends the changed venue and start time, gated the same way', async () => {
    render(<EditEventScreen />);
    await screen.findByDisplayValue('Thursday Mahjong');

    fireEvent.click(screen.getByText('Pick venue (test stub)'));
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '20:30' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEvent).toHaveBeenCalledWith('event-1', {
      title: null,
      venueId: 'venue-2',
      notes: null,
      startTime: '20:30',
    });
  });
});

describe('a series occurrence', () => {
  beforeEach(() => {
    fetchEvent.mockResolvedValue(SERIES_EVENT);
    fetchSeries.mockResolvedValue(SERIES);
  });

  it('offers the scope choice, defaulting to "This game"', async () => {
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    expect(screen.getByText('This game')).toBeTruthy();
    expect(screen.getByText('Every Thursday')).toBeTruthy();
  });

  it('sends the whole-series edit, including clear_ends_on when "Runs indefinitely" is turned on', async () => {
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));

    fireEvent.click(
      screen.getByRole('switch', { name: 'Runs indefinitely, with no end date' }),
    );
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEventSeries).toHaveBeenCalled());
    expect(updateEventSeries).toHaveBeenCalledWith('series-1', {
      title: 'Thursday Mahjong',
      venueId: 'venue-1',
      notes: '',
      startTime: '19:00',
      endsOn: undefined,
      clearEndsOn: true,
      includeOverridden: false,
    });
  });

  it('does not send clear_ends_on when the series already runs indefinitely', async () => {
    fetchSeries.mockResolvedValue({ ...SERIES, ends_on: null });
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEventSeries).toHaveBeenCalled());
    expect(updateEventSeries.mock.calls[0][1]).toMatchObject({
      endsOn: undefined,
      clearEndsOn: false,
    });
  });

  it('sends a newly picked end date as endsOn, not as a clear', async () => {
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));
    fireEvent.change(screen.getByLabelText('Stop repeating on'), {
      target: { value: '2027-06-30' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEventSeries).toHaveBeenCalled());
    expect(updateEventSeries.mock.calls[0][1]).toMatchObject({
      endsOn: '2027-06-30',
      clearEndsOn: false,
    });
  });

  it('offers "Change the schedule", naming how many future games ending it cancels', async () => {
    fetchFutureOccurrenceCount.mockResolvedValue(5);
    render(<EditEventScreen />);
    await screen.findByText(/Ending it cancels 5 future games in it\./);

    fireEvent.click(screen.getByText('Change the schedule'));
    await vi.waitFor(() => expect(endEventSeries).toHaveBeenCalledWith('series-1', true));
    expect(replace).toHaveBeenCalledWith('/clubs/club-1/events/new');
  });

  it('falls back to generic wording when the future count could not be loaded', async () => {
    fetchFutureOccurrenceCount.mockResolvedValue(null);
    render(<EditEventScreen />);
    await screen.findByText('Change the schedule');
    expect(screen.getByText(/Ending it cancels every future game in it\./)).toBeTruthy();
  });

  it('has no "Change the schedule" control for a series that has already ended', async () => {
    fetchSeries.mockResolvedValue({ ...SERIES, ended_at: '2026-08-01T00:00:00Z' });
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    expect(screen.queryByText('Change the schedule')).toBeNull();
    expect(screen.getByText(/already ended/)).toBeTruthy();
  });
});

describe('the overridden-occurrences toggle', () => {
  const CUSTOMISED_A = {
    ...SERIES_EVENT,
    id: 'event-3',
    starts_at: '2026-09-10T10:00:00.000Z',
    overrides: ['venue_id'],
  };
  const CUSTOMISED_B = {
    ...SERIES_EVENT,
    id: 'event-4',
    starts_at: '2026-09-17T10:00:00.000Z',
    overrides: ['notes'],
  };

  beforeEach(() => {
    fetchEvent.mockResolvedValue(SERIES_EVENT);
    fetchSeries.mockResolvedValue(SERIES);
  });

  it('is absent when there is nothing customised to apply to', async () => {
    fetchOverriddenOccurrences.mockResolvedValue([]);
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));
    expect(screen.queryByText(/you've changed/)).toBeNull();
  });

  it('names the customised weeks when there are three or fewer', async () => {
    fetchOverriddenOccurrences.mockResolvedValue([CUSTOMISED_A, CUSTOMISED_B]);
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));

    // Both occurrence dates should be named, not just a bare count -- a
    // single text block, so this checks the whole rendered message rather
    // than word-boundary-matching a fragment glued to its neighbours (see
    // the task report's note on react-native-web Text concatenation).
    const message = await screen.findByText(
      /Also apply this edit to the 2 games you've changed/,
    );
    expect(message.textContent).toContain('10 Sept');
    expect(message.textContent).toContain('17 Sept');
  });

  it('reaches the RPC as include_overridden when switched on', async () => {
    fetchOverriddenOccurrences.mockResolvedValue([CUSTOMISED_A]);
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));

    await screen.findByText(/you've changed/);
    fireEvent.click(
      screen.getByRole('switch', {
        name: "Also apply this edit to the 1 games you've changed",
      }),
    );
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEventSeries).toHaveBeenCalled());
    expect(updateEventSeries.mock.calls[0][1]).toMatchObject({
      includeOverridden: true,
    });
  });

  it('does not silently claim there is nothing customised when the fetch fails', async () => {
    fetchOverriddenOccurrences.mockResolvedValue(null);
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));
    await screen.findByText(/Could not check which games you've changed/);
    expect(screen.queryByText(/Also apply this edit/)).toBeNull();
  });
});

describe('a series that failed to load', () => {
  it('says so, and still lets the host edit this one game', async () => {
    fetchEvent.mockResolvedValue(SERIES_EVENT);
    fetchSeries.mockResolvedValue(null);
    render(<EditEventScreen />);

    await screen.findByText(/Could not load this game's series/);
    expect(screen.queryByText('This game')).toBeNull();
    expect(screen.queryByText('The whole series')).toBeNull();

    fireEvent.click(screen.getByText('Save'));
    await vi.waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEventSeries).not.toHaveBeenCalled();
  });
});
