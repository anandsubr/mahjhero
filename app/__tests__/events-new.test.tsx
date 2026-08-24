import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const canGoBack = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1' };

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

const createEvent = vi.fn();
const createEventSeries = vi.fn();

// nextOccurrences and frequencyLabel stay real (pure functions) -- the whole
// point of the preview tests below is to exercise the actual date maths
// against the real implementation, the same pattern app/__tests__/clubs.test
// uses for formatEventWhen.
vi.mock('../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/events')>();
  return {
    ...actual,
    createEvent: (...args: unknown[]) => createEvent(...args),
    createEventSeries: (...args: unknown[]) => createEventSeries(...args),
  };
});

// VenuePicker does its own venue search over lib/venues/supabase, which is
// irrelevant to this screen's own logic (timezone maths, the recurrence
// preview, weekday derivation). Stubbed to a single button that reports a
// fixed venue, so every test below can get past the "choose where you are
// playing" requirement without a real search round trip.
vi.mock('../../components/VenuePicker', () => ({
  default: ({ onChange }: { onChange: (id: string, name: string) => void }) => (
    <button onClick={() => onChange('venue-1', 'The Annexe')}>
      Pick venue (test stub)
    </button>
  ),
}));

import NewEventScreen from '../clubs/[id]/events/new';

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
  useSessionMock.mockReturnValue({
    session: { user: { id: 'test-user' } },
    loading: false,
  });
  fetchClub.mockResolvedValue(CLUB);
  createEvent.mockResolvedValue({ eventId: 'event-1', error: null });
  createEventSeries.mockResolvedValue({ seriesId: 'series-1', error: null });
  // Defaults to the common case (reached via a push from the club screen).
  // Tests for the no-history path override this to false.
  canGoBack.mockReturnValue(true);
});

function pickVenue() {
  fireEvent.click(screen.getByText('Pick venue (test stub)'));
}

// A guard-ordering regression this repo has already hit twice (the club
// detail screen, and app/index.tsx's storage race): `ready` is only ever set
// inside an effect gated on a signed-in session, so a signed-out visitor can
// never make it true. Checking `!ready` before `!session` traps them on the
// spinner forever instead of sending them to sign in. The task-13 brief's
// sample code had the guards in exactly that wrong order.
describe('guard ordering', () => {
  it('redirects to sign-in instead of spinning forever when signed out', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<NewEventScreen />);
    const redirect = await screen.findByTestId('redirect');
    expect(redirect.getAttribute('data-href')).toBe('/sign-in');
    expect(fetchClub).not.toHaveBeenCalled();
  });
});

/*
 * Cancel used to always call `router.back()`, which throws
 * ("The action 'GO_BACK' was not handled by any navigator.") when this
 * screen is reached with no history to pop -- a direct URL, a page reload
 * on web, a deep link, or a cold launch straight into the route. It must
 * fall back to an explicit destination in that case, and keep using plain
 * `back()` (not a duplicate push) when history genuinely exists.
 */
describe('Cancel', () => {
  it('calls back() when there is history to pop', async () => {
    canGoBack.mockReturnValue(true);
    render(<NewEventScreen />);
    await screen.findByText('Add a game');

    fireEvent.click(screen.getByLabelText('Cancel'));

    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to the club screen when there is no history', async () => {
    canGoBack.mockReturnValue(false);
    render(<NewEventScreen />);
    await screen.findByText('Add a game');

    fireEvent.click(screen.getByLabelText('Cancel'));

    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/clubs/club-1');
  });
});

/*
 * This screen converts no timezones any more. Both paths send the club-local
 * calendar date and wall-clock time the host picked, and Postgres resolves the
 * instant against `clubs.timezone` -- `create_event` for a one-off game
 * exactly as `materialize_one_series` already did for every week of a series
 * (supabase/migrations/20260823070000).
 *
 * So what this layer can honestly check is that the digits arrive unaltered.
 * `npm test` is pinned to TZ=America/New_York (package.json) and the club
 * fixtures below are deliberately OTHER zones, so any reintroduced conversion
 * shows up here as a shifted `date` or `startTime` -- and the dates chosen are
 * the two 2027 US DST transitions, where a conversion bug moves the calendar
 * day rather than merely the hour.
 *
 * That the values sent then produce the RIGHT instant is not knowable at this
 * layer, and is not asserted here. It is pinned against the real database, on
 * these same dates and with the device zone deliberately mismatched, in
 * lib/schema-contract.test.ts ("club-local calendar values resolve to
 * instants").
 */
describe('one-off creation sends club-local calendar values', () => {
  it('sends the picked date and wall time unconverted for a club in another zone', async () => {
    const TOKYO_CLUB = { ...CLUB, timezone: 'Asia/Tokyo' };
    fetchClub.mockResolvedValue(TOKYO_CLUB);
    render(<NewEventScreen />);

    await screen.findByText('Add a game');
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2027-09-07' },
    });
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '19:00' },
    });
    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Tuesday night' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(createEvent).toHaveBeenCalled());
    const call = createEvent.mock.calls[0][0];
    expect(call.date).toBe('2027-09-07');
    expect(call.startTime).toBe('19:00');
    // Default duration, in minutes -- the screen no longer computes an end
    // instant at all.
    expect(call.durationMinutes).toBe(180);
    expect(call).not.toHaveProperty('startsAt');
    expect(call).not.toHaveProperty('endsAt');
  });

  it('does not shift the calendar day on the spring-forward date', async () => {
    // 2027-03-14 is the US spring-forward date, and 02:00-03:00 does not
    // exist that morning in America/New_York. A conversion built on the
    // device's own offset (this suite runs at TZ=America/New_York) is exactly
    // what used to move a date like this one.
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2027-03-14' },
    });
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '00:30' },
    });
    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Small hours' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(createEvent).toHaveBeenCalled());
    const call = createEvent.mock.calls[0][0];
    expect(call.date).toBe('2027-03-14');
    expect(call.startTime).toBe('00:30');
  });

  it('does not shift the calendar day on the fall-back date', async () => {
    // 2027-11-07: 01:00-02:00 happens twice in America/New_York. Same
    // reasoning as above, from the other side of the year.
    const TOKYO_CLUB = { ...CLUB, timezone: 'Asia/Tokyo' };
    fetchClub.mockResolvedValue(TOKYO_CLUB);
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2027-11-07' },
    });
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '01:30' },
    });
    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'The repeated hour' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(createEvent).toHaveBeenCalled());
    const call = createEvent.mock.calls[0][0];
    expect(call.date).toBe('2027-11-07');
    expect(call.startTime).toBe('01:30');
  });
});

/*
 * A save that failed must say so and leave the host on the form with what
 * they typed. Deleting the whole `if (result.error)` block from either path
 * used to leave the suite green -- the host would have been navigated away
 * from a game that was never created.
 */
describe('a failed save', () => {
  it('shows the error and does not navigate away when createEvent fails', async () => {
    createEvent.mockResolvedValue({ eventId: null, error: 'Something broke.' });
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Doomed game' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Something broke.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    // Still on the form, with the typed name intact.
    expect(
      (screen.getByLabelText('Game name') as HTMLInputElement).value,
    ).toBe('Doomed game');
  });

  it('shows the error and does not navigate away when createEventSeries fails', async () => {
    createEventSeries.mockResolvedValue({
      seriesId: null,
      error: 'Something broke.',
    });
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    fireEvent.click(screen.getByText('Every week'));
    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Doomed series' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText('Something broke.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('navigates to the club once the save actually succeeds', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Real game' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/clubs/club-1'));
  });
});

// The series path sends the club-local date and wall time separately and
// lets Postgres resolve the instant (create_event_series's
// `(occurrence_date + start_time) at time zone club_tz`) -- so, unlike the
// one-off path, no client-side timezone conversion should happen here at
// all. Asserting the raw strings pass through unconverted is what would
// catch a regression where someone "fixes" this path to also call
// clubInstant, double-converting the time server-side.
describe('series creation', () => {
  it('sends the club-local date and wall time unconverted, letting the database resolve the instant', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2027-09-07' },
    });
    fireEvent.change(screen.getByLabelText('Start time'), {
      target: { value: '19:00' },
    });
    fireEvent.click(screen.getByText('Every week'));
    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Tuesday night' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(createEventSeries).toHaveBeenCalled());
    const call = createEventSeries.mock.calls[0][0];
    expect(call.startsOn).toBe('2027-09-07');
    expect(call.startTime).toBe('19:00');
    expect(call.frequency).toBe('weekly');
    // 2027-09-07 is a Tuesday.
    expect(call.weekday).toBe(2);
  });
});

// "Monthly" means the same weekday-of-month as the picked date, derived
// rather than asked -- and the preview must never promise more than the
// host's own end date allows.
describe('monthly recurrence and the preview', () => {
  it('derives the 5th-Tuesday rule from the picked date without asking twice', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    // 2027-08-31 is the 5th Tuesday of August 2027 (lib/events.test.ts's own
    // fixture: the three 5th Tuesdays in 2027 are March 30, June 29, and
    // August 31).
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2027-08-31' },
    });
    fireEvent.click(screen.getByText('Monthly'));

    expect(
      await screen.findByText(/The 5th Tuesday of the month/),
    ).toBeTruthy();

    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Monthly game' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(createEventSeries).toHaveBeenCalled());
    const call = createEventSeries.mock.calls[0][0];
    expect(call.frequency).toBe('monthly_nth_weekday');
    expect(call.weekday).toBe(2);
    expect(call.nthWeek).toBe(5);
  });

  it('shows a preview that agrees with what the series will actually materialize, honouring the end date', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    fireEvent.change(screen.getByLabelText('Date'), {
      target: { value: '2027-08-31' },
    });
    fireEvent.click(screen.getByText('Monthly'));

    // Unclamped: the next three 5th Tuesdays starting from 2027-08-31 (the
    // next two, per lib/events.test.ts's own fixture, land in November 2027
    // and February 2028).
    expect(
      await screen.findByText(/Next: 2027-08-31, 2027-11-30, 2028-02-29/),
    ).toBeTruthy();

    // The field shows nothing until the host chooses an end date, because
    // nothing is what gets sent (`endsOn: null`). It used to show the START
    // date instead -- a value the host never picked, contradicting the
    // preview immediately above it.
    expect(
      (screen.getByLabelText('Stop repeating on') as HTMLInputElement).value,
    ).toBe('');

    // And because it shows nothing, the start date is now selectable. While
    // the field pre-filled 2027-08-31, that one date fired no change event
    // when picked -- a controlled input already holding a value sees no
    // change -- so the single most likely end date a host would choose was
    // the one the screen ignored. Picking it here both proves the fix and
    // clamps the preview to exactly one occurrence.
    fireEvent.change(screen.getByLabelText('Stop repeating on'), {
      target: { value: '2027-08-31' },
    });

    const preview = await screen.findByText(/^The 5th Tuesday of the month\. Next: 2027-08-31$/);
    expect(preview.textContent).not.toMatch(/2027-11-30/);

    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Monthly game' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(createEventSeries).toHaveBeenCalled());
    // What is shown is what is sent.
    expect(createEventSeries.mock.calls[0][0].endsOn).toBe('2027-08-31');
  });
});

/*
 * components/DateField.web.tsx ignores an empty change and keeps the value it
 * already has: a cleared <input type="date"> reports "", and there is no
 * meaningful "no date" for the game's own date. Deleting that guard left the
 * whole suite green, so this fires the "" and checks what the screen actually
 * sends afterwards -- not merely that the control still renders.
 */
describe('clearing a date field', () => {
  it('keeps the date already picked rather than sending an empty one', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');

    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2027-08-31' } });
    fireEvent.change(dateInput, { target: { value: '' } });
    expect(dateInput.value).toBe('2027-08-31');

    pickVenue();
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'Still dated' },
    });
    fireEvent.click(screen.getByText('Save'));

    await vi.waitFor(() => expect(createEvent).toHaveBeenCalled());
    expect(createEvent.mock.calls[0][0].date).toBe('2027-08-31');
  });
});

describe('a date in the past is not offered', () => {
  /*
   * A game dated in the past used to save, redirect on success, and then be
   * visible nowhere: `fetchUpcomingEvents` filters `starts_at >= now()` and
   * is the only events listing the app has, so a mistyped year produced a
   * game that existed only in the database.
   *
   * The `min` attribute is the cheap half of the fix -- the browser's
   * calendar simply greys out earlier days. It is advisory (it blocks no
   * submit), so it is not the guarantee; the guarantee is
   * supabase/migrations/20260824001000, covered by the pgTAP suite and by
   * lib/schema-contract.test.ts. What this asserts is that the screen
   * actually passes the floor down to both of its date fields, which nothing
   * else in the suite would notice.
   */
  function todayLocal(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  it('floors the game date at today', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');

    expect(
      (screen.getByLabelText('Date') as HTMLInputElement).getAttribute('min'),
    ).toBe(todayLocal());
  });

  it('floors the series end date at today too', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    fireEvent.click(screen.getByText('Every week'));

    expect(
      (screen.getByLabelText('Stop repeating on') as HTMLInputElement).getAttribute(
        'min',
      ),
    ).toBe(todayLocal());
  });
});

describe('venue is required', () => {
  it('refuses to save without a venue and never calls createEvent', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');
    fireEvent.change(screen.getByLabelText('Game name'), {
      target: { value: 'No venue yet' },
    });
    fireEvent.click(screen.getByText('Save'));

    expect(
      await screen.findByText('Choose where you are playing.'),
    ).toBeTruthy();
    expect(createEvent).not.toHaveBeenCalled();
    expect(createEventSeries).not.toHaveBeenCalled();
  });
});

// Guards against `accessibilityState={{ selected }}` creeping back into the
// duration/table-count/repeat chips: react-native-web's createDOMProps has
// no handling for `accessibilityState` at all (components/Toggle.tsx's
// docstring has the full account), so that prop renders `role="button"` with
// no state at all -- a host could not tell which duration, table count, or
// repeat rhythm was chosen. Both states are pinned against their literal
// strings, not `not.toBe('true')`, since a missing attribute would also
// satisfy that.
describe('the duration/table-count/repeat chips reach the DOM with aria-selected', () => {
  it('marks the default chips as selected and their siblings as not', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');

    const selectedDuration = screen.getByRole('button', { name: '3 hours' });
    expect(selectedDuration.getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getByRole('button', { name: '2 hours' }).getAttribute('aria-selected'),
    ).toBe('false');

    expect(
      screen.getByRole('button', { name: '1 table' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: '2 tables' }).getAttribute('aria-selected'),
    ).toBe('false');

    expect(
      screen.getByRole('button', { name: 'Just once' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Every week' }).getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('flips aria-selected to the newly chosen duration chip', async () => {
    render(<NewEventScreen />);
    await screen.findByText('Add a game');

    fireEvent.click(screen.getByRole('button', { name: '2 hours' }));

    expect(
      screen.getByRole('button', { name: '2 hours' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: '3 hours' }).getAttribute('aria-selected'),
    ).toBe('false');
  });
});
