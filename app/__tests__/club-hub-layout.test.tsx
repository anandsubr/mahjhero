import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
const replace = vi.fn();
let segments = ['clubs', '[id]', '(hub)', 'games'];
// Lets a test swap in a section that reads the hub context.
const slot = vi.hoisted(() => ({ impl: null as null | (() => React.ReactElement) }));
// The latest focus callback, so a test can simulate the hub regaining
// focus (e.g. coming back from club settings).
const focus = vi.hoisted(() => ({ cb: null as null | (() => void | (() => void)) }));

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  Slot: () => (slot.impl ? slot.impl() : <div data-testid="slot" />),
  useRouter: () => ({ push, replace, back: vi.fn() }),
  useLocalSearchParams: () => ({ id: 'c1' }),
  useSegments: () => segments,
  // Runs on mount like the real hook's first focus; re-focus is simulated
  // by calling `focus.cb` again.
  useFocusEffect: (cb: () => void | (() => void)) => {
    focus.cb = cb;
    useEffect(cb, [cb]);
  },
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
import { useClubHub } from '../../components/hub/ClubHubContext';

function ReloadProbe() {
  const { club, reloadClub } = useClubHub();
  return (
    <button type="button" data-testid="probe" onClick={() => void reloadClub()}>
      {club.name}
    </button>
  );
}

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
  slot.impl = null;
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

  it('shows a back button to Home while loading', () => {
    fetchClub.mockReturnValue(new Promise(() => {}));
    render(<ClubHubLayout />);
    expect(screen.getByTestId('club-hub-header-skeleton')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Back to home'));
    expect(replace).toHaveBeenCalledWith('/home');
  });

  it('keeps the ready hub when a background reload fails', async () => {
    slot.impl = () => <ReloadProbe />;
    render(<ClubHubLayout />);
    await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
    fetchClub.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByTestId('probe'));
    await waitFor(() => expect(fetchClub).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByText('Could not load this club.')).toBeNull();
    expect(screen.getByTestId('probe').textContent).toBe('Riverside Mah Jongg');
  });

  it('a successful background reload updates the club', async () => {
    slot.impl = () => <ReloadProbe />;
    render(<ClubHubLayout />);
    await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
    fetchClub.mockResolvedValueOnce({ ...CLUB, name: 'Renamed Club' });
    fireEvent.click(screen.getByTestId('probe'));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('Renamed Club'));
    expect(screen.queryByTestId('club-hub-header-skeleton')).toBeNull();
  });

  it('reloads the club when it regains focus, e.g. back from settings', async () => {
    render(<ClubHubLayout />);
    await waitFor(() => expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy());
    // The first focus is the mount, which the initial load already covers.
    expect(fetchClub).toHaveBeenCalledTimes(1);
    fetchClub.mockResolvedValueOnce({ ...CLUB, cover_path: 'c1/new.jpg' });
    getClubCoverUrl.mockResolvedValueOnce('https://example.com/new.jpg');
    await act(async () => {
      focus.cb?.();
    });
    await waitFor(() => expect(screen.getByTestId('club-hub-cover-photo')).toBeTruthy());
    expect(fetchClub).toHaveBeenCalledTimes(2);
  });

  it('fetches once on a cold open where the user id arrives late', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: true });
    const { rerender } = render(<ClubHubLayout />);
    expect(fetchClub).not.toHaveBeenCalled();
    useSessionMock.mockReturnValue({ session: { user: { id: 'me' } }, loading: false });
    rerender(<ClubHubLayout />);
    await waitFor(() => expect(screen.getByText('Riverside Mah Jongg')).toBeTruthy());
    await act(async () => {});
    expect(fetchClub).toHaveBeenCalledTimes(1);
  });

  it('still offers Retry when the initial load fails on a late-arriving user id', async () => {
    useSessionMock.mockReturnValue({ session: null, loading: true });
    const { rerender } = render(<ClubHubLayout />);
    fetchClub.mockResolvedValueOnce(null);
    useSessionMock.mockReturnValue({ session: { user: { id: 'me' } }, loading: false });
    rerender(<ClubHubLayout />);
    await waitFor(() => expect(screen.getByText('Could not load this club.')).toBeTruthy());
    expect(screen.getByLabelText('Retry')).toBeTruthy();
    expect(fetchClub).toHaveBeenCalledTimes(1);
  });

  it('does not reload on focus while the hub is still loading', async () => {
    fetchClub.mockReturnValueOnce(new Promise(() => {}));
    render(<ClubHubLayout />);
    await act(async () => {
      focus.cb?.();
    });
    expect(fetchClub).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('club-hub-header-skeleton')).toBeTruthy();
  });
});
