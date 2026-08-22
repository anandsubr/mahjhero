import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1' };

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

// The core correctness property of this screen: a one-off event's instant
// must be computed in the CLUB's timezone, not the device's. `npm test` runs
// with TZ=America/New_York (package.json), so the club fixture below is
// deliberately a DIFFERENT zone with no DST (Asia/Tokyo, always UTC+9) --
// mirroring the same anti-accidental-pass technique app/__tests__/clubs.test
// already uses for formatEventWhen. The expected instant is derived by hand,
// never by calling the function under test, so a regression to the "compare
// naive against a single toLocaleString conversion" bug (which is off by
// exactly the DEVICE's own UTC offset, and happens to cancel out only when
// device and club share a zone) would land 4-5 hours away from this
// assertion under the suite's pinned America/New_York TZ.
describe('one-off event instant', () => {
  it('computes the instant in the club timezone, not the device timezone', async () => {
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
    // 19:00 JST on 2027-09-07 is 10:00 UTC the same day (JST is UTC+9,
    // year-round -- no DST to complicate the arithmetic).
    expect(call.startsAt).toBe('2027-09-07T10:00:00.000Z');
    // Default duration is 3 hours.
    expect(call.endsAt).toBe('2027-09-07T13:00:00.000Z');
  });

  it('gives a different instant for the same wall-clock time in a different club timezone', async () => {
    render(<NewEventScreen />); // CLUB.timezone === 'America/New_York'
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
    // 19:00 EDT (America/New_York is UTC-4 in September) is 23:00 UTC.
    expect(call.startsAt).toBe('2027-09-07T23:00:00.000Z');
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

    // Stop the series between the 1st and 2nd occurrence. The "Stop
    // repeating on" field's shown value already defaults to the picked
    // start date (2027-08-31) when `endsOn` is unset, so setting it back to
    // that SAME value would look like a no-op to React's controlled-input
    // change tracking and never fire onChange -- picking a distinct date
    // is what actually proves the screen threads `endsOn` state into
    // `nextOccurrences` at all, which is the one thing this test checks
    // (the exact inclusive-boundary clamp itself is already covered
    // exhaustively at the pure-function level in lib/events.test.ts).
    fireEvent.change(screen.getByLabelText('Stop repeating on'), {
      target: { value: '2027-10-01' },
    });

    const preview = await screen.findByText(/^The 5th Tuesday of the month\. Next: 2027-08-31$/);
    expect(preview.textContent).not.toMatch(/2027-11-30/);
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
