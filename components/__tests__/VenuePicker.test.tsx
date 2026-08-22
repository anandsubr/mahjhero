import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VenuePicker from '../VenuePicker';
import { colors } from '../../lib/theme';

// react-native-web (the version pinned here) never wires Pressable's
// `accessibilityState={{ checked }}` through to `aria-checked` on web — see
// createDOMProps, which recognises the deprecated `accessibilityChecked` /
// `aria-checked` *props* but has no handling for `accessibilityState` at
// all. So `aria-checked` is simply absent from Toggle's rendered output in
// this environment; asserting it (as an earlier draft of this test did)
// would silently pass for the wrong reason (`null !== 'false'` — actually
// fails, good — but "true" would look identical to "not present", a false
// negative waiting to happen) rather than checking anything about which
// track color rendered. What Toggle actually renders instead is the
// track's background color (`colors.neutral[400]` off vs
// `colors.accentColor` on, per components/Toggle.tsx's own styles), so
// that's what this test reads.
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const value = parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

vi.mock('../../lib/venues', () => ({
  searchVenues: vi.fn(),
  createVenue: vi.fn(),
}));

import { createVenue, searchVenues } from '../../lib/venues';

const MATCHES = [
  {
    id: 'v1',
    name: 'St Mary’s Hall',
    address_line: null,
    locality: 'Newton',
    visibility: 'public' as const,
    is_own_club: false,
  },
  {
    id: 'v2',
    name: 'St Michael’s Rooms',
    address_line: null,
    locality: 'Newton',
    visibility: 'club' as const,
    is_own_club: true,
  },
];

describe('VenuePicker', () => {
  beforeEach(() => {
    // Reset (not just re-stub) so call counts/args from one test never leak
    // into the next — several tests assert exact call counts, which a bare
    // `mockResolvedValue` without clearing history would corrupt.
    vi.mocked(searchVenues).mockReset().mockResolvedValue(MATCHES);
    vi.mocked(createVenue).mockReset().mockResolvedValue({ venueId: 'v3', error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('offers both the matches and an add option for what was typed', async () => {
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'St' },
    });

    // The failure this guards against is a picker that hides "Add" as soon
    // as anything matches — which is exactly when a host adding a second,
    // similarly-named hall needs it.
    await waitFor(() => {
      expect(screen.getByText('St Mary’s Hall')).toBeTruthy();
    });
    expect(screen.getByText('St Michael’s Rooms')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add “St”/ })).toBeTruthy();
    // Confirms the matches shown actually came from the mocked search call,
    // not from some other rendering path — this would fail if searchVenues
    // were never invoked.
    expect(searchVenues).toHaveBeenCalledWith('c1', 'St');
  });

  it('groups the club’s own venues above public ones', async () => {
    const { container } = render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'St' },
    });

    await waitFor(() => {
      expect(screen.getByText('This club')).toBeTruthy();
    });
    expect(screen.getByText('Public venues')).toBeTruthy();

    // Checking that both headings are present (as the brief's own version
    // of this test does) passes even if the venues underneath them are
    // swapped between groups — two labels existing somewhere on the page
    // proves nothing about which venue sits under which. Reading document
    // order instead pins both which venue lands in which group AND that
    // "This club" renders first, which is the actual requirement ("own
    // club first").
    const text = container.textContent ?? '';
    const thisClubAt = text.indexOf('This club');
    const stMichaelAt = text.indexOf('St Michael’s Rooms'); // is_own_club: true
    const publicVenuesAt = text.indexOf('Public venues');
    const stMaryAt = text.indexOf('St Mary’s Hall'); // is_own_club: false
    expect(thisClubAt).toBeGreaterThanOrEqual(0);
    expect(stMichaelAt).toBeGreaterThanOrEqual(0);
    expect(publicVenuesAt).toBeGreaterThanOrEqual(0);
    expect(stMaryAt).toBeGreaterThanOrEqual(0);
    expect(thisClubAt).toBeLessThan(stMichaelAt);
    expect(stMichaelAt).toBeLessThan(publicVenuesAt);
    expect(publicVenuesAt).toBeLessThan(stMaryAt);
  });

  it('reports the chosen venue by id and name', async () => {
    const onChange = vi.fn();
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'St' },
    });

    await waitFor(() => {
      expect(screen.getByText('St Mary’s Hall')).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: 'St Mary’s Hall' }));

    expect(onChange).toHaveBeenCalledWith('v1', 'St Mary’s Hall');
  });

  it('does not search, and shows no dropdown, while the field is empty', async () => {
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'St' },
    });
    fireEvent.change(screen.getByLabelText('Venue'), { target: { value: '' } });

    // Give any (wrongly-fired) debounced search a chance to resolve before
    // asserting its absence.
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(screen.queryByText('St Mary’s Hall')).toBeNull();
    expect(screen.queryAllByRole('button', { name: /^Add / })).toHaveLength(0);
  });

  it('coalesces rapid keystrokes into a single debounced search', async () => {
    vi.useFakeTimers();
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={() => {}} />,
    );

    const field = screen.getByLabelText('Venue');
    fireEvent.change(field, { target: { value: 'S' } });
    vi.advanceTimersByTime(50);
    fireEvent.change(field, { target: { value: 'St' } });
    vi.advanceTimersByTime(50);
    fireEvent.change(field, { target: { value: 'St ' } });

    // Nothing should have fired yet — each keystroke reset the debounce
    // window, so at 100ms total elapsed with a 200ms debounce, zero calls is
    // the only value that proves the timer resets rather than accumulates.
    expect(searchVenues).not.toHaveBeenCalled();

    // advanceTimersByTimeAsync (rather than the sync variant) also flushes
    // the microtask queue between ticks, so the mocked searchVenues promise
    // actually resolves within this call instead of leaving the assertion
    // racing a pending microtask.
    await vi.advanceTimersByTimeAsync(200);
    expect(searchVenues).toHaveBeenCalledTimes(1);
    expect(searchVenues).toHaveBeenCalledWith('c1', 'St');
  });

  it('opens the add form with sharing OFF', async () => {
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'Marie’s place' },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add “Marie/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add “Marie/ }));

    // The privacy default, asserted rather than assumed. A great deal of
    // mahjong is played in members' homes. Checked against the OFF track
    // color, not the ON one, so this fails loudly (not silently) if the
    // default is ever flipped.
    const share = screen.getByLabelText('Other clubs can use this venue');
    expect(getComputedStyle(share).backgroundColor).toBe(
      hexToRgb(colors.neutral[400]),
    );
    expect(getComputedStyle(share).backgroundColor).not.toBe(
      hexToRgb(colors.accentColor),
    );
  });

  it('creates the venue and reports it back', async () => {
    const onChange = vi.fn();
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'The Annexe' },
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Add “The Annexe”/ }),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add “The Annexe”/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save venue' }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('v3', 'The Annexe');
    });
    expect(vi.mocked(createVenue).mock.calls[0][0]).toMatchObject({
      clubId: 'c1',
      name: 'The Annexe',
      sharePublicly: false,
    });
  });

  it('surfaces the library’s own error message on a failed save, not an invented one', async () => {
    vi.mocked(createVenue).mockResolvedValue({
      venueId: null,
      error: 'A shared venue with that name already exists here.',
    });
    const onChange = vi.fn();
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'The Annexe' },
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Add “The Annexe”/ }),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /Add “The Annexe”/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save venue' }));

    await waitFor(() => {
      expect(
        screen.getByText('A shared venue with that name already exists here.'),
      ).toBeTruthy();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to an empty result set, without crashing, when the search fails', async () => {
    vi.mocked(searchVenues).mockResolvedValue(null);
    render(
      <VenuePicker clubId="c1" value={null} valueName="" onChange={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText('Venue'), {
      target: { value: 'St' },
    });

    await waitFor(() => {
      expect(searchVenues).toHaveBeenCalledWith('c1', 'St');
    });
    // The add option still renders — a search outage must not block a host
    // from adding the venue they came here to add.
    expect(screen.getByRole('button', { name: /Add “St”/ })).toBeTruthy();
    expect(screen.queryByText('This club')).toBeNull();
    expect(screen.queryByText('Public venues')).toBeNull();
  });
});
