import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const canGoBack = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1', eventId: 'event-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push, replace, back, canGoBack }),
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
// events-new.test.tsx's pickVenue() pattern. Also renders `valueName` as
// plain text — Fix pass 1's scope-seeding bug (Task 15's review) is
// otherwise invisible from outside: the real VenuePicker never surfaces
// `valueName` as a queryable string on its own, and the bug was exactly
// that the wrong scope's venue name reached this prop.
//
// `valueName` is seeded into local state ONCE on mount, `const [q] =
// useState(valueName)`, mirroring the real component's own mount-only
// seeding (components/VenuePicker.tsx: `useState(valueName)`, never
// resynced on a later prop change). A stub that instead read `valueName`
// live on every render (`<span>{valueName}</span>`) cannot observe a
// remount at all, so it stays green whether or not the edit screen's
// `key={isSeriesScope ? 'series' : 'event'}` on <VenuePicker> is present —
// silently disabling this suite's only way to catch that key being
// removed, which is what actually forces a fresh instance (and therefore a
// fresh seed) when the host switches scope.
vi.mock('../../components/VenuePicker', () => ({
  default: ({
    valueName,
    onChange,
  }: {
    valueName: string;
    onChange: (id: string, name: string) => void;
  }) => {
    const [q] = useState(valueName);
    return (
      <div>
        <span>{q}</span>
        <button onClick={() => onChange('venue-2', 'New Venue')}>
          Pick venue (test stub)
        </button>
      </div>
    );
  },
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
  check_in_required: false,
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
  venue_name: 'The Annexe',
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
  check_in_required: false,
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
  // Defaults to the common case (reached via a push from the event screen).
  // Tests for the no-history path override this to false.
  canGoBack.mockReturnValue(true);
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

/*
 * Cancel used to always call `router.back()`, which throws
 * ("The action 'GO_BACK' was not handled by any navigator.") when this
 * screen is reached with no history to pop -- a direct URL, a page reload
 * on web, a deep link, or a cold launch straight into the route. It must
 * fall back to the event being edited in that case, and keep using plain
 * `back()` (not a duplicate push) when history genuinely exists.
 */
describe('Cancel', () => {
  it('calls back() when there is history to pop', async () => {
    canGoBack.mockReturnValue(true);
    render(<EditEventScreen />);
    await screen.findByDisplayValue('Thursday Mahjong');

    fireEvent.click(screen.getByLabelText('Cancel'));

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to the event screen when there is no history', async () => {
    canGoBack.mockReturnValue(false);
    render(<EditEventScreen />);
    await screen.findByDisplayValue('Thursday Mahjong');

    fireEvent.click(screen.getByLabelText('Cancel'));

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/clubs/club-1/events/event-1');
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
      checkInRequired: null,
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
      checkInRequired: null,
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
      checkInRequired: null,
    });
  });

  // Task 14: the host's "Require check-in" toggle. `ONE_OFF_EVENT` seeds
  // false; this loads it true instead, so the switch's initial state proves
  // it is reading `event.check_in_required`, not just always rendering off
  // the way `events-new.test.tsx`'s screen legitimately does.
  it("shows the event's current check-in setting", async () => {
    fetchEvent.mockResolvedValue({ ...ONE_OFF_EVENT, check_in_required: true });
    render(<EditEventScreen />);
    await screen.findByDisplayValue('Thursday Mahjong');

    expect(
      screen.getByRole('switch', { name: 'Require check-in' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('sends the toggled check-in setting to updateEvent, gated the same way as every other field', async () => {
    render(<EditEventScreen />);
    await screen.findByDisplayValue('Thursday Mahjong');

    fireEvent.click(screen.getByRole('switch', { name: 'Require check-in' }));
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEvent).toHaveBeenCalled());
    expect(updateEvent).toHaveBeenCalledWith('event-1', {
      title: null,
      venueId: null,
      notes: null,
      startTime: null,
      checkInRequired: true,
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

  // This is the control that decides whether a save touches one night or
  // silently rewrites every future week of a recurring series, so a screen
  // reader that cannot tell which one is currently chosen is not a cosmetic
  // gap. Guards against `accessibilityState={{ selected }}` creeping back
  // in: react-native-web's createDOMProps has no handling for
  // `accessibilityState` at all (components/Toggle.tsx's docstring has the
  // full account), so that prop rendered `role="button"` with no state at
  // all. Both states are pinned against their literal strings, not
  // `not.toBe('true')`, since a missing attribute would also satisfy that.
  it('marks the default "This game" scope as selected, and flips aria-selected when "The whole series" is chosen', async () => {
    render(<EditEventScreen />);
    await screen.findByText('The whole series');

    const thisGame = screen.getByRole('button', { name: 'This game only' });
    const wholeSeries = screen.getByRole('button', { name: 'The whole series' });
    expect(thisGame.getAttribute('aria-selected')).toBe('true');
    expect(wholeSeries.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(wholeSeries);

    expect(thisGame.getAttribute('aria-selected')).toBe('false');
    expect(wholeSeries.getAttribute('aria-selected')).toBe('true');
  });

  // Fix pass 1's regression test (Task 15's review): an occurrence whose
  // title/venue/notes/start time are all overridden, so they differ from
  // the series' own values in every field. Switching to "The whole series"
  // and saving WITHOUT touching anything must display, and then send, the
  // SERIES' own values — not the customised occurrence's. Before the fix,
  // this screen seeded the series-scope fields from the occurrence once on
  // load and never re-seeded them, so this exact sequence sent the
  // occurrence's customisation as if it were an intentional series-wide
  // edit, and the RPC's own "did this change?" gate (which compares
  // against the series row) made it worse: because an overridden
  // occurrence's values differ from the series precisely BECAUSE they are
  // overridden, every gate fired and every live future week was rewritten
  // to this one week's customisation.
  it('seeds and displays "The whole series" from the series row, not the customised occurrence being viewed', async () => {
    fetchEvent.mockResolvedValue({
      ...SERIES_EVENT,
      title: 'Beginners night (this week only)',
      venue_id: 'venue-9',
      venue_name: 'Downstairs Room',
      notes: 'Bring a friend',
      // 20:30 JST, distinct from the series' 19:00.
      starts_at: '2026-09-03T11:30:00.000Z',
      overrides: ['title', 'venue_id', 'notes', 'starts_at'],
    });
    render(<EditEventScreen />);
    await screen.findByText('The whole series');

    // "This game" (the default scope) correctly shows the customised
    // occurrence's own values — unaffected by the bug, and the baseline
    // this test's next assertion contrasts against.
    await screen.findByDisplayValue('Beginners night (this week only)');
    expect(screen.getByText('Downstairs Room')).toBeTruthy();

    fireEvent.click(screen.getByText('The whole series'));

    // The heading now reads "The whole series", so the form must show the
    // SERIES' values — showing the occurrence's here would misinform the
    // host before they even press Save.
    await screen.findByDisplayValue('Thursday Mahjong');
    expect(
      screen.queryByDisplayValue('Beginners night (this week only)'),
    ).toBeNull();
    expect(screen.getByText('The Annexe')).toBeTruthy();
    expect(screen.queryByText('Downstairs Room')).toBeNull();

    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEventSeries).toHaveBeenCalled());
    expect(updateEventSeries).toHaveBeenCalledWith('series-1', {
      title: 'Thursday Mahjong',
      venueId: 'venue-1',
      notes: '',
      startTime: '19:00',
      checkInRequired: false,
      endsOn: undefined,
      clearEndsOn: false,
      includeOverridden: false,
    });
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
      checkInRequired: false,
      endsOn: undefined,
      clearEndsOn: true,
      includeOverridden: false,
    });
  });

  // Task 14: the series-scope field is seeded from `series.check_in_required`
  // (SERIES fixture is false), never from the occurrence — the same rule
  // Fix pass 1 established for title/venue/notes/start time, and the same
  // reason "seeds and displays 'The whole series' from the series row" above
  // exists. Sent unconditionally, like the other series-scope fields — not
  // diffed the way the "This game" path diffs `checkInRequired` — because
  // `update_event_series`'s own gate treats an unchanged value as a no-op.
  it('sends the series check-in setting to updateEventSeries when toggled', async () => {
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));

    expect(
      screen.getByRole('switch', { name: 'Require check-in' }).getAttribute('aria-checked'),
    ).toBe('false');

    fireEvent.click(screen.getByRole('switch', { name: 'Require check-in' }));
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEventSeries).toHaveBeenCalled());
    expect(updateEventSeries.mock.calls[0][1]).toMatchObject({
      checkInRequired: true,
    });
  });

  // "Runs indefinitely" is a view of `endsOn`, not an independent fact: OFF
  // must always show whatever end date the series actually has. Before this
  // fix, turning the toggle back off left `endsOn` at '' (only ON cleared
  // it), so the DateField reappeared empty while `series.ends_on` was still
  // '2026-12-31' — a screen showing "no end date" for a series that still
  // had one — and Save then sent neither `endsOnInput` nor `clearEndsOn`,
  // silently keeping the date the screen had just claimed was gone.
  it('restores the series\' own end date when "Runs indefinitely" is turned back off', async () => {
    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));

    const toggle = screen.getByRole('switch', {
      name: 'Runs indefinitely, with no end date',
    });
    fireEvent.click(toggle);
    expect(screen.queryByLabelText('Stop repeating on')).toBeNull();

    fireEvent.click(toggle);
    const dateInput = screen.getByLabelText(
      'Stop repeating on',
    ) as HTMLInputElement;
    expect(dateInput.value).toBe('2026-12-31');

    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(updateEventSeries).toHaveBeenCalled());
    expect(updateEventSeries.mock.calls[0][1]).toMatchObject({
      endsOn: undefined,
      clearEndsOn: false,
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

  it('floors the end date at today, so a mistyped year cannot wipe the run', async () => {
    /*
     * Shortening a run now DELETES the future weeks beyond the new end
     * (supabase/migrations/20260824000000), which is what makes the change
     * reversible -- but it also means a mistyped year in this one field
     * clears the whole run in a single save. The database does not refuse a
     * past end date, and should not: pulling a run's end back legitimately
     * means "this series is over". So the picker declining to offer the day
     * is where that mistake is stopped, and this is the only assertion that
     * would notice the prop going missing.
     */
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${now.getFullYear()}-${month}-${day}`;

    render(<EditEventScreen />);
    await screen.findByText('The whole series');
    fireEvent.click(screen.getByText('The whole series'));

    expect(
      (screen.getByLabelText('Stop repeating on') as HTMLInputElement).getAttribute(
        'min',
      ),
    ).toBe(today);
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
        name: "Also apply this edit to the 1 game you've changed",
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

// Task 3 made eventStartTimeInZone return '' for a starts_at that new
// Date() cannot parse, reasoning that an empty TimeField is the honest
// state. That only holds on web (TimeField.web.tsx renders an empty
// <input type="time">) -- the native TimeField has no empty state, so ''
// falls through lib/time.ts's timeStringToDate to midnight and the picker
// shows a plausible "12:00 AM". A host who merely confirms that dialog
// saves a midnight nobody chose over the real stored value. Fix pass 1
// closes that path by refusing the whole form instead of ever handing a
// TimeField an unreadable time. Asserted on 'Game name', a form control
// every other test in this file relies on being present -- if the guard
// were dropped, this test would fail the same way those do.
describe('a game whose start time cannot be read', () => {
  it('refuses to render the form, showing an error instead', async () => {
    fetchEvent.mockResolvedValue({ ...ONE_OFF_EVENT, starts_at: 'not-a-date' });
    render(<EditEventScreen />);

    await screen.findByText(
      "This game's start time could not be read, so it cannot be edited.",
    );
    expect(screen.queryByLabelText('Game name')).toBeNull();
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
