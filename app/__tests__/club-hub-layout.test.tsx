import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const replace = vi.fn();
let segments = ['clubs', '[id]', '(hub)', 'games'];

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  Slot: () => <div data-testid="slot" />,
  useRouter: () => ({ push, replace, back: vi.fn() }),
  useLocalSearchParams: () => ({ id: 'c1' }),
  useSegments: () => segments,
}));

const useSessionMock = vi.fn(
  (): { session: { user: { id: string } } | null; loading: boolean } => ({
    session: { user: { id: 'me' } },
    loading: false,
  }),
);
vi.mock('../../lib/session', () => ({ useSession: () => useSessionMock() }));

const fetchClub = vi.fn();
const fetchMyRoles = vi.fn();
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchClub: (...args: unknown[]) => fetchClub(...args),
    fetchMyRoles: (...args: unknown[]) => fetchMyRoles(...args),
  };
});

const getClubCoverUrl = vi.fn();
vi.mock('../../lib/club-cover', () => ({
  getClubCoverUrl: (...args: unknown[]) => getClubCoverUrl(...args),
}));

import ClubHubLayout from '../clubs/[id]/(hub)/_layout';
import ClubIndex from '../clubs/[id]/index';

const CLUB = {
  id: 'c1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: '',
  visibility: 'private' as const,
  timezone: 'America/New_York',
  default_game_mode: 'open_play' as const,
  code: 'RIVER24',
  cover_path: null,
  cover_color: 'accent2_800' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  segments = ['clubs', '[id]', '(hub)', 'games'];
  useSessionMock.mockReturnValue({ session: { user: { id: 'me' } }, loading: false });
  fetchClub.mockResolvedValue(CLUB);
  fetchMyRoles.mockResolvedValue([{ club_id: 'c1', role: 'member' }]);
  getClubCoverUrl.mockResolvedValue(null);
});

describe('club hub layout', () => {
  it('redirects the club index to the Games section', () => {
    render(<ClubIndex />);
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/clubs/c1/games');
  });

  it('redirects signed-out visitors to sign-in', () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<ClubHubLayout />);
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/sign-in');
  });

  it('renders the header over the active section, marking it selected', async () => {
    segments = ['clubs', '[id]', '(hub)', 'members'];
    render(<ClubHubLayout />);
    await waitFor(() => expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy());
    expect(screen.getByTestId('slot')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Members' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByLabelText('Club settings')).toBeNull();
    expect(getClubCoverUrl).not.toHaveBeenCalled();
  });

  it('shows organizers the gear and routes back, settings and sections', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'c1', role: 'co_organizer' }]);
    render(<ClubHubLayout />);
    await waitFor(() => expect(screen.getByLabelText('Club settings')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('Club settings'));
    expect(push).toHaveBeenCalledWith('/clubs/c1/settings');
    fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
    expect(replace).toHaveBeenCalledWith('/clubs/c1/board');
    fireEvent.click(screen.getByLabelText('Back to home'));
    expect(replace).toHaveBeenCalledWith('/home');
  });

  it('resolves the cover photo URL when the club has one', async () => {
    fetchClub.mockResolvedValue({ ...CLUB, cover_path: 'c1/x.jpg' });
    getClubCoverUrl.mockResolvedValue('https://example.com/x.jpg');
    render(<ClubHubLayout />);
    await waitFor(() => expect(screen.getByTestId('club-hub-cover-photo')).toBeTruthy());
    expect(getClubCoverUrl).toHaveBeenCalledWith('c1/x.jpg');
  });

  it('shows an error with Retry when the club fails to load', async () => {
    fetchClub.mockResolvedValueOnce(null);
    render(<ClubHubLayout />);
    await waitFor(() => expect(screen.getByText('Could not load this club.')).toBeTruthy());
    expect(screen.queryByTestId('slot')).toBeNull();
    fireEvent.click(screen.getByLabelText('Retry'));
    await waitFor(() => expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy());
    expect(fetchClub).toHaveBeenCalledTimes(2);
  });
});
