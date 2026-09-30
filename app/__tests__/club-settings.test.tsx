import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const canGoBack = vi.fn(() => true);

vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => <div data-testid="redirect" data-href={href} />,
  useRouter: () => ({ push, replace, back, canGoBack }),
  useLocalSearchParams: () => ({ id: 'c1' }),
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
const setClubCode = vi.fn();
const setDefaultGameMode = vi.fn();
vi.mock('../../lib/clubs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/clubs')>();
  return {
    ...actual,
    fetchClub: (...args: unknown[]) => fetchClub(...args),
    fetchMyRoles: (...args: unknown[]) => fetchMyRoles(...args),
    setClubCode: (...args: unknown[]) => setClubCode(...args),
    setDefaultGameMode: (...args: unknown[]) => setDefaultGameMode(...args),
  };
});

const uploadClubCover = vi.fn();
const removeClubCover = vi.fn();
const setClubCoverColor = vi.fn();
const getClubCoverUrl = vi.fn();
vi.mock('../../lib/club-cover', () => ({
  uploadClubCover: (...args: unknown[]) => uploadClubCover(...args),
  removeClubCover: (...args: unknown[]) => removeClubCover(...args),
  setClubCoverColor: (...args: unknown[]) => setClubCoverColor(...args),
  getClubCoverUrl: (...args: unknown[]) => getClubCoverUrl(...args),
}));

const pickImages = vi.fn();
vi.mock('../../lib/attachments', () => ({
  pickImages: (...args: unknown[]) => pickImages(...args),
}));

import ClubSettingsScreen from '../clubs/[id]/settings';

const CLUB = {
  id: 'c1',
  name: 'Riverside Mah Jongg',
  slug: 'riverside',
  rhythm: '',
  visibility: 'private' as const,
  timezone: 'America/New_York',
  default_game_mode: 'open_play' as const,
  code: 'TEST1',
  cover_path: null as string | null,
  cover_color: 'accent2_800' as const,
};

const IMAGE = { uri: 'file:///photo.jpg', width: 3000, height: 2000 };

beforeEach(() => {
  vi.clearAllMocks();
  canGoBack.mockReturnValue(true);
  useSessionMock.mockReturnValue({ session: { user: { id: 'me' } }, loading: false });
  fetchClub.mockResolvedValue(CLUB);
  fetchMyRoles.mockResolvedValue([{ club_id: 'c1', role: 'host' }]);
  getClubCoverUrl.mockResolvedValue(null);
  uploadClubCover.mockResolvedValue({ error: null });
  removeClubCover.mockResolvedValue({ error: null });
  setClubCoverColor.mockResolvedValue({ error: null });
  setDefaultGameMode.mockResolvedValue({ error: null });
  pickImages.mockResolvedValue([IMAGE]);
});

describe('access', () => {
  it('redirects signed-out visitors to sign-in', () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<ClubSettingsScreen />);
    expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/sign-in');
  });

  it('redirects a plain member to the Games section', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'c1', role: 'member' }]);
    render(<ClubSettingsScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('redirect').getAttribute('data-href')).toBe('/clubs/c1/games'),
    );
  });

  it('lets a co-organizer in', async () => {
    fetchMyRoles.mockResolvedValue([{ club_id: 'c1', role: 'co_organizer' }]);
    render(<ClubSettingsScreen />);
    expect(await screen.findByText('Club settings')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
  });

  it('shows an error with Retry when the club fails to load', async () => {
    fetchClub.mockResolvedValueOnce(null);
    render(<ClubSettingsScreen />);
    expect(await screen.findByText('Could not load this club.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Retry'));
    expect(await screen.findByText('Club settings')).toBeTruthy();
  });

  it('goes back to the hub, or replaces to Games with nothing to pop', async () => {
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByLabelText('Back to the club'));
    expect(back).toHaveBeenCalled();
    canGoBack.mockReturnValue(false);
    fireEvent.click(screen.getByLabelText('Back to the club'));
    expect(replace).toHaveBeenCalledWith('/clubs/c1/games');
  });
});

describe('cover', () => {
  it('previews the cover colour when there is no photo, and offers Upload photo', async () => {
    render(<ClubSettingsScreen />);
    expect(await screen.findByTestId('settings-cover-color')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
  });

  it('previews the photo with Replace and Remove when one is set', async () => {
    fetchClub.mockResolvedValue({ ...CLUB, cover_path: 'c1/a.jpg' });
    getClubCoverUrl.mockResolvedValue('https://example.com/a.jpg');
    render(<ClubSettingsScreen />);
    expect(await screen.findByTestId('settings-cover-photo')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace photo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeTruthy();
  });

  it('uploads the first picked image and reloads the club', async () => {
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload photo' }));
    await waitFor(() => expect(uploadClubCover).toHaveBeenCalledWith('c1', IMAGE));
    expect(pickImages).toHaveBeenCalledWith('library', 0);
    await waitFor(() => expect(fetchClub).toHaveBeenCalledTimes(2));
  });

  it('does nothing when the picker is cancelled', async () => {
    pickImages.mockResolvedValue(null);
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload photo' }));
    await waitFor(() => expect(pickImages).toHaveBeenCalled());
    expect(uploadClubCover).not.toHaveBeenCalled();
  });

  it('shows an upload failure inline', async () => {
    uploadClubCover.mockResolvedValue({ error: 'Something went wrong.' });
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload photo' }));
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  });

  it('disables the cover buttons while an upload is in flight', async () => {
    uploadClubCover.mockReturnValue(new Promise(() => {}));
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Upload photo' }));
    await waitFor(() => expect(uploadClubCover).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Upload photo' }));
    await Promise.resolve();
    expect(pickImages).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Uploading…')).toBeTruthy();
  });

  it('removes the photo', async () => {
    fetchClub.mockResolvedValue({ ...CLUB, cover_path: 'c1/a.jpg' });
    getClubCoverUrl.mockResolvedValue('https://example.com/a.jpg');
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(removeClubCover).toHaveBeenCalledWith('c1'));
  });

  it('rings the selected swatch and saves a tapped colour', async () => {
    render(<ClubSettingsScreen />);
    const green = await screen.findByRole('radio', { name: 'Dark green' });
    expect(green.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Clay' }).getAttribute('aria-checked')).toBe('false');
    fetchClub.mockResolvedValue({ ...CLUB, cover_color: 'accent_700' });
    fireEvent.click(screen.getByRole('radio', { name: 'Clay' }));
    await waitFor(() => expect(setClubCoverColor).toHaveBeenCalledWith('c1', 'accent_700'));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Clay' }).getAttribute('aria-checked')).toBe('true'),
    );
  });

  it('shows a colour failure inline', async () => {
    setClubCoverColor.mockResolvedValue({ error: 'Something went wrong.' });
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Olive' }));
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  });
});

describe('refresh after a change', () => {
  it('says so inline when the change saved but the refetch failed', async () => {
    render(<ClubSettingsScreen />);
    const olive = await screen.findByRole('radio', { name: 'Olive' });
    fetchClub.mockResolvedValueOnce(null);
    fireEvent.click(olive);
    await waitFor(() => expect(setClubCoverColor).toHaveBeenCalledWith('c1', 'accent2_700'));
    expect(
      await screen.findByText('Saved, but the preview could not be refreshed.'),
    ).toBeTruthy();
    // The screen itself stays up -- no failure state.
    expect(screen.getByText('Club settings')).toBeTruthy();
  });

  it('a code save does not revert a cover refetch that landed while it was saving', async () => {
    let resolveCode: (v: { code: string; error: null }) => void = () => {};
    setClubCode.mockReturnValueOnce(new Promise((r) => (resolveCode = r)));
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change club code' }));
    fireEvent.change(screen.getByLabelText('New club code'), { target: { value: 'NEWCODE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save code' }));
    // A colour change completes (and refetches) while the code save is pending.
    fetchClub.mockResolvedValue({ ...CLUB, cover_color: 'accent_700' });
    fireEvent.click(screen.getByRole('radio', { name: 'Clay' }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Clay' }).getAttribute('aria-checked')).toBe('true'),
    );
    await act(async () => resolveCode({ code: 'NEWCODE', error: null }));
    expect(await screen.findByText('Club code: NEWCODE')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Clay' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('club code', () => {
  it('lets an organizer change the code', async () => {
    setClubCode.mockResolvedValueOnce({ code: 'NEWCODE', error: null });
    render(<ClubSettingsScreen />);
    expect(await screen.findByText('Club code: TEST1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change club code' }));
    fireEvent.change(screen.getByLabelText('New club code'), { target: { value: 'newcode' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save code' }));
    expect(await screen.findByText('Club code: NEWCODE')).toBeTruthy();
    expect(setClubCode).toHaveBeenCalledWith('c1', 'NEWCODE');
  });

  it('shows the taken error', async () => {
    setClubCode.mockResolvedValueOnce({ code: null, error: 'That code is taken.' });
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Change club code' }));
    fireEvent.change(screen.getByLabelText('New club code'), { target: { value: 'OAK2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save code' }));
    expect(await screen.findByText('That code is taken.')).toBeTruthy();
  });
});

describe('game mode and links', () => {
  it('toggles new games to invite-only', async () => {
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByLabelText('New games default to invite-only'));
    await waitFor(() => expect(setDefaultGameMode).toHaveBeenCalledWith('c1', 'invite_only'));
  });

  it('links to Venues and Import a roster', async () => {
    render(<ClubSettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Venues' }));
    expect(push).toHaveBeenCalledWith('/clubs/c1/venues');
    fireEvent.click(screen.getByRole('button', { name: 'Import a roster from a spreadsheet' }));
    expect(push).toHaveBeenCalledWith('/clubs/c1/import');
  });
});
