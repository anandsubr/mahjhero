import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const push = vi.fn();

const searchParams: Record<string, string> = { id: 'club-1' };

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => (
    <div data-testid="redirect" data-href={href} />
  ),
  useRouter: () => ({ push }),
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
const fetchRoster = vi.fn();

// `canInvite` stays real (it is pure, and is exactly the host-or-co-organizer
// test the SQL enforces) -- only the two network calls are stubbed, the same
// partial-mock pattern app/__tests__/clubs.test.tsx uses for this module.
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchClub: (...args: unknown[]) => fetchClub(...args),
    fetchRoster: (...args: unknown[]) => fetchRoster(...args),
  };
});

const fetchClubVenues = vi.fn();
const updateVenue = vi.fn();
const archiveVenue = vi.fn();
const searchVenues = vi.fn();

vi.mock('../../lib/venues', () => ({
  fetchClubVenues: (...args: unknown[]) => fetchClubVenues(...args),
  updateVenue: (...args: unknown[]) => updateVenue(...args),
  archiveVenue: (...args: unknown[]) => archiveVenue(...args),
  searchVenues: (...args: unknown[]) => searchVenues(...args),
}));

import VenuesScreen from '../clubs/[id]/venues';

const CLUB = {
  id: 'club-1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: 'Thursday evenings',
  visibility: 'private' as const,
  timezone: 'America/New_York',
};

const HOST = { profile_id: 'test-user', role: 'host', display_name: 'Ada', skill_level: null };
const MEMBER = { profile_id: 'test-user', role: 'member', display_name: 'Ada', skill_level: null };

const OWN_VENUE = {
  id: 'venue-1',
  name: 'The Annexe',
  address_line: '42 Elm Street',
  locality: 'Springfield',
  region: null,
  postal_code: null,
  visibility: 'club' as const,
};

const SHARED_VENUE = {
  id: 'venue-2',
  name: 'Community Hall',
  address_line: null,
  locality: null,
  region: null,
  postal_code: null,
  visibility: 'public' as const,
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
  fetchRoster.mockResolvedValue([HOST]);
  fetchClubVenues.mockResolvedValue([OWN_VENUE]);
  updateVenue.mockResolvedValue({ error: null });
  archiveVenue.mockResolvedValue({ error: null });
});

// A guard-ordering regression this branch has already hit on four other
// screens: `ready` is only ever set inside an effect gated on a signed-in
// session, so a signed-out visitor can never make it true. Checking
// `!ready` before `!session` traps them on the spinner forever instead of
// redirecting to sign-in.
describe('guard ordering', () => {
  it('redirects to sign-in instead of spinning forever when signed out', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<VenuesScreen />);
    const redirect = await screen.findByTestId('redirect');
    expect(redirect.getAttribute('data-href')).toBe('/sign-in');
    expect(fetchClub).not.toHaveBeenCalled();
    expect(fetchClubVenues).not.toHaveBeenCalled();
  });
});

describe('venue source', () => {
  it("fetches this club's own venues, not the public typeahead search", async () => {
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    expect(fetchClubVenues).toHaveBeenCalledWith('club-1');
    expect(searchVenues).not.toHaveBeenCalled();
  });
});

describe('empty and failed states', () => {
  it('says there are no venues yet, distinct from a failed fetch', async () => {
    fetchClubVenues.mockResolvedValue([]);
    render(<VenuesScreen />);
    expect(
      await screen.findByText('No venues yet. The first one is added when you create a game.'),
    ).toBeTruthy();
  });

  // A failed venue fetch must not be reported as "no venues" (a false
  // statement) and must not blank the rest of the screen, which loaded
  // fine -- the same shape of bug the club detail screen's events section
  // was fixed against.
  it('reports a failed venue fetch without claiming there are none, and without blanking the screen', async () => {
    fetchClubVenues.mockResolvedValue(null);
    render(<VenuesScreen />);

    expect(await screen.findByText(/Venues could not be loaded/)).toBeTruthy();
    expect(screen.queryByText('No venues yet. The first one is added when you create a game.')).toBeNull();
    // The rest of the screen is unaffected.
    expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy();
    expect(screen.getByText('Venues')).toBeTruthy();
    expect(screen.queryByText(/Could not reach MahjHero/)).toBeNull();
  });

  it('shows a full-page error when the club itself fails to load', async () => {
    fetchClub.mockResolvedValue(null);
    render(<VenuesScreen />);
    expect(await screen.findByText(/Could not reach MahjHero/)).toBeTruthy();
    expect(screen.queryByText('The Annexe')).toBeNull();
  });
});

describe('organizer-only controls', () => {
  it('offers Edit and Retire to a host', async () => {
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    expect(screen.getByLabelText('Edit The Annexe')).toBeTruthy();
    expect(screen.getByLabelText('Retire The Annexe')).toBeTruthy();
  });

  it('hides Edit and Retire from a plain member, who can still see the list', async () => {
    fetchRoster.mockResolvedValue([MEMBER]);
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    expect(screen.queryByLabelText('Edit The Annexe')).toBeNull();
    expect(screen.queryByLabelText('Retire The Annexe')).toBeNull();
  });
});

describe('public venues', () => {
  it('says a shared venue cannot be made private again, and still offers edit controls to the owning club', async () => {
    fetchClubVenues.mockResolvedValue([SHARED_VENUE]);
    render(<VenuesScreen />);
    await screen.findByText('Community Hall');
    expect(screen.getByText('Shared')).toBeTruthy();
    expect(
      screen.getByText(/cannot be made private again/),
    ).toBeTruthy();
    // The owning club can still fix the name/address -- there is no
    // un-publish function, but that is not the same as no edit function.
    expect(screen.getByLabelText('Edit Community Hall')).toBeTruthy();
  });

  it('does not show the shared explanation for a club-only venue', async () => {
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    expect(screen.queryByText('Shared')).toBeNull();
    expect(screen.queryByText(/cannot be made private again/)).toBeNull();
  });
});

describe('editing a venue', () => {
  it('pre-fills the form with the current name and address', async () => {
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    fireEvent.click(screen.getByLabelText('Edit The Annexe'));
    expect((screen.getByLabelText('Name of The Annexe') as HTMLInputElement).value).toBe(
      'The Annexe',
    );
    expect(
      (screen.getByLabelText('Address of The Annexe') as HTMLInputElement).value,
    ).toBe('42 Elm Street');
  });

  it('saves the corrected name and address, then reloads the list and closes the form', async () => {
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    fireEvent.click(screen.getByLabelText('Edit The Annexe'));

    fireEvent.change(screen.getByLabelText('Name of The Annexe'), {
      target: { value: 'The Annex' },
    });
    fireEvent.change(screen.getByLabelText('Address of The Annexe'), {
      target: { value: '43 Elm Street' },
    });

    fetchClubVenues.mockResolvedValue([{ ...OWN_VENUE, name: 'The Annex', address_line: '43 Elm Street' }]);
    fireEvent.click(screen.getByLabelText('Save The Annexe'));

    await vi.waitFor(() => expect(updateVenue).toHaveBeenCalled());
    expect(updateVenue).toHaveBeenCalledWith('venue-1', {
      name: 'The Annex',
      addressLine: '43 Elm Street',
    });
    // The list is reloaded from the server rather than trusted from the
    // form, and the corrected name shows on the (now closed) view.
    expect(await screen.findByText('The Annex')).toBeTruthy();
    expect(screen.queryByLabelText('Name of The Annexe')).toBeNull();
    expect(fetchClubVenues).toHaveBeenCalledTimes(2);
  });

  it('refuses to save a blank name and never calls updateVenue', async () => {
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    fireEvent.click(screen.getByLabelText('Edit The Annexe'));
    fireEvent.change(screen.getByLabelText('Name of The Annexe'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByLabelText('Save The Annexe'));

    expect(await screen.findByText('Give the venue a name.')).toBeTruthy();
    expect(updateVenue).not.toHaveBeenCalled();
  });

  it('shows the error and stays on the form when the save fails', async () => {
    updateVenue.mockResolvedValue({ error: 'Something broke.' });
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    fireEvent.click(screen.getByLabelText('Edit The Annexe'));
    fireEvent.click(screen.getByLabelText('Save The Annexe'));

    expect(await screen.findByText('Something broke.')).toBeTruthy();
    // Still editing -- the field is still on screen with what was typed.
    expect(screen.getByLabelText('Name of The Annexe')).toBeTruthy();
    expect(fetchClubVenues).toHaveBeenCalledTimes(1);
  });

  it('cancels back to the read-only view without saving', async () => {
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    fireEvent.click(screen.getByLabelText('Edit The Annexe'));
    fireEvent.change(screen.getByLabelText('Name of The Annexe'), {
      target: { value: 'Something else entirely' },
    });
    fireEvent.click(screen.getByLabelText('Cancel editing'));

    expect(screen.queryByLabelText('Name of The Annexe')).toBeNull();
    expect(screen.getByText('The Annexe')).toBeTruthy();
    expect(updateVenue).not.toHaveBeenCalled();
  });
});

describe('retiring a venue', () => {
  it('archives rather than deletes, using "retire" copy', async () => {
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    expect(screen.queryByLabelText('Delete The Annexe')).toBeNull();
    expect(screen.getByLabelText('Retire The Annexe')).toBeTruthy();
  });

  it('reloads the list after retiring, so an archived venue drops out', async () => {
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');

    fetchClubVenues.mockResolvedValue([]);
    fireEvent.click(screen.getByLabelText('Retire The Annexe'));

    await vi.waitFor(() => expect(archiveVenue).toHaveBeenCalledWith('venue-1'));
    expect(
      await screen.findByText('No venues yet. The first one is added when you create a game.'),
    ).toBeTruthy();
  });

  it('shows the error and keeps the venue listed when archiving fails', async () => {
    archiveVenue.mockResolvedValue({ error: 'Something broke.' });
    render(<VenuesScreen />);
    await screen.findByText('The Annexe');
    fireEvent.click(screen.getByLabelText('Retire The Annexe'));

    expect(await screen.findByText('Something broke.')).toBeTruthy();
    expect(screen.getByText('The Annexe')).toBeTruthy();
    expect(fetchClubVenues).toHaveBeenCalledTimes(1);
  });
});
