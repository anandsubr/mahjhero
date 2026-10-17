import { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Linking, Platform } from 'react-native';
import type { Club, ClubRole } from '../../lib/clubs';
import type { ClubMedia } from '../../lib/club-media';

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('expo-document-picker', () => ({ getDocumentAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-image-manipulator', () => ({}));

// react-native-web's RefreshControl never fires onRefresh in jsdom, so swap
// in a button exposing the prop (same approach as app/__tests__/home.test.tsx).
vi.mock('../../components/hub/HubSection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/hub/HubSection')>();
  return {
    ...actual,
    default: (props: Parameters<typeof actual.default>[0]) => {
      const { onRefresh, ...rest } = props;
      return (
        <>
          {onRefresh ? (
            <button type="button" aria-label="refresh-control" onClick={() => void onRefresh()} />
          ) : null}
          <actual.default {...rest} />
        </>
      );
    },
  };
});

let focusCallback: (() => void) | null = null;
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  useLocalSearchParams: () => ({ id: 'c1' }),
  useFocusEffect: (cb: () => void) => {
    focusCallback = cb;
    useEffect(cb, [cb]);
  },
}));

vi.mock('../../lib/session', () => ({
  useSession: () => ({ session: { user: { id: 'me' } }, loading: false }),
}));

const fetchClubMedia = vi.fn();
const uploadClubPhotos = vi.fn();
const pickClubFile = vi.fn();
const uploadClubFile = vi.fn();
const removeClubMedia = vi.fn();
const getMediaUrls = vi.fn();
vi.mock('../../lib/club-media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/club-media')>();
  return {
    ...actual,
    fetchClubMedia: (...a: unknown[]) => fetchClubMedia(...a),
    uploadClubPhotos: (...a: unknown[]) => uploadClubPhotos(...a),
    pickClubFile: (...a: unknown[]) => pickClubFile(...a),
    uploadClubFile: (...a: unknown[]) => uploadClubFile(...a),
    removeClubMedia: (...a: unknown[]) => removeClubMedia(...a),
    getMediaUrls: (...a: unknown[]) => getMediaUrls(...a),
  };
});

const pickImages = vi.fn();
vi.mock('../../lib/attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/attachments')>();
  return { ...actual, pickImages: (...a: unknown[]) => pickImages(...a) };
});

import PhotosSection from '../clubs/[id]/(hub)/photos';
import { ClubHubContext } from '../../components/hub/ClubHubContext';
import { FILE_TYPE_ERROR } from '../../lib/club-media';
import { GENERIC_ERROR } from '../../lib/constants';

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

function media(i: number, overrides: Partial<ClubMedia> = {}): ClubMedia {
  const kind = overrides.kind ?? 'photo';
  return {
    id: `m${i}`,
    clubId: 'c1',
    kind,
    storagePath: kind === 'photo' ? `c1/photos/p${i}.jpg` : `c1/files/u${i}/doc${i}.pdf`,
    fileName: kind === 'photo' ? `p${i}.jpg` : `doc${i}.pdf`,
    mimeType: kind === 'photo' ? 'image/jpeg' : 'application/pdf',
    sizeBytes: 120 * 1024,
    width: 1600,
    height: 1200,
    uploadedBy: 'other',
    uploaderName: 'Priya Shah',
    // Newest first: lower i is newer.
    createdAt: new Date(Date.UTC(2026, 8, 29, 12, 0, 0) - i * 60_000).toISOString(),
    ...overrides,
  };
}

function photos(n: number, from = 0): ClubMedia[] {
  return Array.from({ length: n }, (_, k) => media(from + k));
}

function renderSection(role: ClubRole | null = 'member') {
  return render(
    <ClubHubContext.Provider value={{ club: CLUB, role, reloadClub: vi.fn() }}>
      <PhotosSection />
    </ClubHubContext.Provider>,
  );
}

const originalOS = Platform.OS;
function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  focusCallback = null;
  fetchClubMedia.mockResolvedValue([]);
  getMediaUrls.mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, `https://signed/${p}`])),
  );
  removeClubMedia.mockResolvedValue({ error: null });
});

afterEach(() => {
  setOS(originalOS);
});

describe('club hub Photos & Files section', () => {
  it('defaults to Photos, fetching the newest 60 photos, with an "Add photos" button', async () => {
    renderSection();
    expect(await screen.findByText('No photos yet. Tap + to add the first one.')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Photos' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Files' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('button', { name: 'Add photos' })).toBeTruthy();
    expect(fetchClubMedia).toHaveBeenCalledWith('c1', 'photo', undefined, 60);
  });

  it('Files tab fetches files, shows its empty state and an "Add a file" button', async () => {
    renderSection();
    await screen.findByText('No photos yet. Tap + to add the first one.');
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('No files yet. Tap + to add one.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a file' })).toBeTruthy();
    expect(fetchClubMedia).toHaveBeenLastCalledWith('c1', 'file', undefined, 60);
  });

  it('renders photos in the grid with signed URLs', async () => {
    fetchClubMedia.mockResolvedValue(photos(2));
    renderSection();
    expect(await screen.findByRole('button', { name: 'Open photo 1 of 2' })).toBeTruthy();
    await waitFor(() =>
      expect(getMediaUrls).toHaveBeenCalledWith(['c1/photos/p0.jpg', 'c1/photos/p1.jpg']),
    );
  });

  it('ignores a slower, older fetch when tabs switch quickly', async () => {
    let resolvePhotos: (v: ClubMedia[]) => void = () => {};
    fetchClubMedia.mockImplementationOnce(
      () => new Promise<ClubMedia[]>((r) => { resolvePhotos = r; }),
    );
    fetchClubMedia.mockResolvedValueOnce([media(5, { kind: 'file' })]);
    renderSection();
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('doc5.pdf')).toBeTruthy();
    await act(async () => resolvePhotos(photos(3)));
    expect(screen.queryByRole('button', { name: /Open photo/ })).toBeNull();
    expect(screen.getByText('doc5.pdf')).toBeTruthy();
  });

  it('uploads a photo batch with "Uploading 2 of 3…", disables + meanwhile, then reloads', async () => {
    const picked = [1, 2, 3].map((n) => ({ uri: `file://${n}`, width: 10, height: 10 }));
    pickImages.mockResolvedValue(picked);
    let progress: (done: number, total: number) => void = () => {};
    let finish: (v: { added: number; errors: string[] }) => void = () => {};
    uploadClubPhotos.mockImplementation((_c: string, _i: unknown, onProgress: typeof progress) => {
      progress = onProgress;
      return new Promise((r) => { finish = r; });
    });
    renderSection();
    await screen.findByText('No photos yet. Tap + to add the first one.');

    fireEvent.click(screen.getByRole('button', { name: 'Add photos' }));
    expect(await screen.findByText('Uploading 1 of 3…')).toBeTruthy();
    expect(pickImages).toHaveBeenCalledWith('library', 0, 10);
    expect(uploadClubPhotos).toHaveBeenCalledWith('c1', picked, expect.any(Function));
    const add = screen.getByRole('button', { name: 'Add photos' });
    expect(add.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(add);
    expect(pickImages).toHaveBeenCalledTimes(1);

    act(() => progress(1, 3));
    expect(screen.getByText('Uploading 2 of 3…')).toBeTruthy();

    fetchClubMedia.mockResolvedValue(photos(3));
    await act(async () => finish({ added: 3, errors: [] }));
    expect(await screen.findByRole('button', { name: 'Open photo 1 of 3' })).toBeTruthy();
    expect(screen.queryByText(/Uploading/)).toBeNull();
    expect(fetchClubMedia).toHaveBeenCalledTimes(2);
  });

  it('shows a failed photo inline while the rest are added', async () => {
    pickImages.mockResolvedValue([{ uri: 'a', width: 1, height: 1 }, { uri: 'b', width: 1, height: 1 }]);
    uploadClubPhotos.mockResolvedValue({ added: 1, errors: ['Something went wrong.'] });
    renderSection();
    await screen.findByText('No photos yet. Tap + to add the first one.');
    fireEvent.click(screen.getByRole('button', { name: 'Add photos' }));
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
    await waitFor(() => expect(fetchClubMedia).toHaveBeenCalledTimes(2));
  });

  it('does nothing when the photo picker is cancelled', async () => {
    pickImages.mockResolvedValue(null);
    renderSection();
    await screen.findByText('No photos yet. Tap + to add the first one.');
    fireEvent.click(screen.getByRole('button', { name: 'Add photos' }));
    await waitFor(() => expect(pickImages).toHaveBeenCalled());
    expect(uploadClubPhotos).not.toHaveBeenCalled();
  });

  it('a refused file shows the exact error and nothing is reloaded', async () => {
    const file = { uri: 'file://x', name: 'song.mp3', mimeType: 'audio/mpeg', size: 10 };
    pickClubFile.mockResolvedValue(file);
    uploadClubFile.mockResolvedValue({ error: FILE_TYPE_ERROR });
    renderSection();
    await screen.findByText('No photos yet. Tap + to add the first one.');
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findByText('No files yet. Tap + to add one.');
    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));
    expect(await screen.findByText("That file type isn't supported.")).toBeTruthy();
    expect(uploadClubFile).toHaveBeenCalledWith('c1', file);
    expect(fetchClubMedia).toHaveBeenCalledTimes(2);
  });

  it('an oversized file shows "Files can be up to 10 MB." and + is usable again', async () => {
    pickClubFile.mockResolvedValue({ uri: 'u', name: 'big.pdf', mimeType: 'application/pdf', size: 11 * 1024 * 1024 });
    uploadClubFile.mockResolvedValue({ error: 'Files can be up to 10 MB.' });
    renderSection();
    await screen.findByText('No photos yet. Tap + to add the first one.');
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findByText('No files yet. Tap + to add one.');
    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));
    expect(await screen.findByText('Files can be up to 10 MB.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add a file' }).getAttribute('aria-disabled')).not.toBe('true'),
    );
  });

  it('switching tabs clears an upload error', async () => {
    pickImages.mockResolvedValue([{ uri: 'a', width: 1, height: 1 }]);
    uploadClubPhotos.mockResolvedValue({ added: 0, errors: ['Something went wrong.'] });
    renderSection();
    await screen.findByText('No photos yet. Tap + to add the first one.');
    fireEvent.click(screen.getByRole('button', { name: 'Add photos' }));
    await screen.findByText('Something went wrong.');
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findByText('No files yet. Tap + to add one.');
    expect(screen.queryByText('Something went wrong.')).toBeNull();
  });

  it('a successful file upload reloads the Files list', async () => {
    pickClubFile.mockResolvedValue({ uri: 'u', name: 'rules.pdf', mimeType: 'application/pdf', size: 5 });
    uploadClubFile.mockResolvedValue({ error: null });
    renderSection();
    await screen.findByText('No photos yet. Tap + to add the first one.');
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findByText('No files yet. Tap + to add one.');
    fetchClubMedia.mockResolvedValue([media(1, { kind: 'file', fileName: 'rules.pdf' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Add a file' }));
    expect(await screen.findByText('rules.pdf')).toBeTruthy();
  });

  it('"Show more" appends the next 60 from the last loaded item, and hides once short', async () => {
    const first = photos(60);
    fetchClubMedia.mockResolvedValueOnce(first);
    fetchClubMedia.mockResolvedValueOnce(photos(5, 60));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('button', { name: 'Open photo 65 of 65' })).toBeTruthy();
    expect(fetchClubMedia).toHaveBeenLastCalledWith('c1', 'photo', first[59].createdAt, 60);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('no "Show more" when the first page is short', async () => {
    fetchClubMedia.mockResolvedValue(photos(3));
    renderSection();
    await screen.findByRole('button', { name: 'Open photo 1 of 3' });
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('refresh after three pages reloads all 180, not a capped count', async () => {
    fetchClubMedia.mockResolvedValueOnce(photos(60));
    fetchClubMedia.mockResolvedValueOnce(photos(60, 60));
    fetchClubMedia.mockResolvedValueOnce(photos(60, 120));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByRole('button', { name: 'Open photo 120 of 120' });
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByRole('button', { name: 'Open photo 180 of 180' });
    fetchClubMedia.mockResolvedValueOnce(photos(180));
    fireEvent.click(screen.getByLabelText('refresh-control'));
    await waitFor(() =>
      expect(fetchClubMedia).toHaveBeenLastCalledWith('c1', 'photo', undefined, 180),
    );
    expect(await screen.findByRole('button', { name: 'Open photo 180 of 180' })).toBeTruthy();
  });

  it('pull-to-refresh reloads the loaded count so pages do not collapse', async () => {
    fetchClubMedia.mockResolvedValueOnce(photos(60));
    fetchClubMedia.mockResolvedValueOnce(photos(60, 60));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await screen.findByRole('button', { name: 'Open photo 120 of 120' });
    fetchClubMedia.mockResolvedValueOnce(photos(120));
    fireEvent.click(screen.getByLabelText('refresh-control'));
    await waitFor(() =>
      expect(fetchClubMedia).toHaveBeenLastCalledWith('c1', 'photo', undefined, 120),
    );
    expect(await screen.findByRole('button', { name: 'Open photo 120 of 120' })).toBeTruthy();
  });

  it('refetches on focus', async () => {
    renderSection();
    await waitFor(() => expect(fetchClubMedia).toHaveBeenCalledTimes(1));
    await act(async () => focusCallback?.());
    expect(fetchClubMedia).toHaveBeenCalledTimes(2);
    expect(fetchClubMedia).toHaveBeenLastCalledWith('c1', 'photo', undefined, 60);
  });

  describe('Remove', () => {
    it('a non-uploader member sees no Remove in the viewer or on a file', async () => {
      fetchClubMedia.mockResolvedValueOnce([media(1)]);
      renderSection('member');
      fireEvent.click(await screen.findByRole('button', { name: 'Open photo 1 of 1' }));
      expect(await screen.findByText('Added by Priya Shah · Tue 29 Sept')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Close image viewer' }));

      fetchClubMedia.mockResolvedValueOnce([media(2, { kind: 'file' })]);
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      await screen.findByText('doc2.pdf');
      expect(screen.queryByRole('button', { name: 'More options' })).toBeNull();
    });

    it('the uploader removes their photo after confirming', async () => {
      fetchClubMedia.mockResolvedValue([media(1, { uploadedBy: 'me' }), media(2)]);
      renderSection('member');
      fireEvent.click(await screen.findByRole('button', { name: 'Open photo 1 of 2' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
      expect(screen.getByText('Remove this photo?')).toBeTruthy();
      const sheet = screen.getByTestId('confirm-sheet');
      fireEvent.click(within(sheet).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(removeClubMedia).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' })));
      expect(await screen.findByRole('button', { name: 'Open photo 1 of 1' })).toBeTruthy();
    });

    it('an organizer removes someone else\'s file after confirming', async () => {
      fetchClubMedia.mockResolvedValueOnce([]);
      fetchClubMedia.mockResolvedValueOnce([media(3, { kind: 'file' })]);
      renderSection('co_organizer');
      await screen.findByText('No photos yet. Tap + to add the first one.');
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      await screen.findByText('doc3.pdf');
      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      expect(screen.getByText('Remove this file?')).toBeTruthy();
      fireEvent.click(within(screen.getByTestId('confirm-sheet')).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(removeClubMedia).toHaveBeenCalledWith(expect.objectContaining({ id: 'm3' })));
      expect(await screen.findByText('No files yet. Tap + to add one.')).toBeTruthy();
    });

    it('a failed remove keeps the item and says so', async () => {
      removeClubMedia.mockResolvedValue({ error: 'Something went wrong.' });
      fetchClubMedia.mockResolvedValueOnce([]);
      fetchClubMedia.mockResolvedValueOnce([media(3, { kind: 'file', uploadedBy: 'me' })]);
      renderSection('member');
      await screen.findByText('No photos yet. Tap + to add the first one.');
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      await screen.findByText('doc3.pdf');
      fireEvent.click(screen.getByRole('button', { name: 'More options' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
      fireEvent.click(within(screen.getByTestId('confirm-sheet')).getByRole('button', { name: 'Remove' }));
      expect(await screen.findByText('Something went wrong.')).toBeTruthy();
      expect(screen.getByText('doc3.pdf')).toBeTruthy();
    });
  });

  it('a failed Remove in the photo viewer shows the error inside the viewer, cleared on navigate and close', async () => {
    removeClubMedia.mockResolvedValue({ error: 'Something went wrong.' });
    fetchClubMedia.mockResolvedValue([media(1, { uploadedBy: 'me' }), media(2)]);
    renderSection('member');
    fireEvent.click(await screen.findByRole('button', { name: 'Open photo 1 of 2' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByTestId('confirm-sheet')).getByRole('button', { name: 'Remove' }));
    const err = await screen.findByTestId('media-viewer-error');
    expect(err.textContent).toBe('Something went wrong.');
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(screen.queryByTestId('media-viewer-error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByTestId('confirm-sheet')).getByRole('button', { name: 'Remove' }));
    await screen.findByTestId('media-viewer-error');
    fireEvent.click(screen.getByRole('button', { name: 'Close image viewer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open photo 1 of 2' }));
    expect(screen.queryByTestId('media-viewer-error')).toBeNull();
    expect(screen.queryByText('Something went wrong.')).toBeNull();
  });

  it('a reload already in flight cannot bring a removed item back', async () => {
    fetchClubMedia.mockResolvedValueOnce([]);
    fetchClubMedia.mockResolvedValueOnce([media(3, { kind: 'file', uploadedBy: 'me' })]);
    renderSection('member');
    await screen.findByText('No photos yet. Tap + to add the first one.');
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    await screen.findByText('doc3.pdf');
    let resolveStale: (v: ClubMedia[]) => void = () => {};
    fetchClubMedia.mockImplementationOnce(
      () => new Promise<ClubMedia[]>((r) => { resolveStale = r; }),
    );
    fireEvent.click(screen.getByLabelText('refresh-control'));
    fireEvent.click(screen.getByRole('button', { name: 'More options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(within(screen.getByTestId('confirm-sheet')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('No files yet. Tap + to add one.')).toBeTruthy();
    await act(async () => resolveStale([media(3, { kind: 'file', uploadedBy: 'me' })]));
    expect(screen.queryByText('doc3.pdf')).toBeNull();
  });

  describe('opening a file', () => {
    it('native: opens the signed URL with Linking', async () => {
      setOS('ios');
      const openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(true);
      fetchClubMedia.mockResolvedValueOnce([]);
      fetchClubMedia.mockResolvedValueOnce([media(4, { kind: 'file' })]);
      renderSection();
      await screen.findByText('No photos yet. Tap + to add the first one.');
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Open doc4.pdf' }));
      await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://signed/c1/files/u4/doc4.pdf'));
      expect(getMediaUrls).toHaveBeenCalledWith(['c1/files/u4/doc4.pdf']);
      openURL.mockRestore();
    });

    it('web: opens the signed URL in a new tab', async () => {
      setOS('web');
      const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
      const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      fetchClubMedia.mockResolvedValueOnce([]);
      fetchClubMedia.mockResolvedValueOnce([media(4, { kind: 'file' })]);
      renderSection();
      await screen.findByText('No photos yet. Tap + to add the first one.');
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Download doc4.pdf' }));
      await waitFor(() => expect(tab.location.href).toBe('https://signed/c1/files/u4/doc4.pdf'));
      expect(open).toHaveBeenCalledWith('', '_blank');
      expect(tab.opener).toBeNull();
      open.mockRestore();
    });

    it('web: closes the blank tab and says so when no signed URL comes back', async () => {
      setOS('web');
      getMediaUrls.mockResolvedValue({});
      const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
      const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      fetchClubMedia.mockResolvedValueOnce([]);
      fetchClubMedia.mockResolvedValueOnce([media(4, { kind: 'file' })]);
      renderSection();
      await screen.findByText('No photos yet. Tap + to add the first one.');
      fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Open doc4.pdf' }));
      await waitFor(() => expect(tab.close).toHaveBeenCalled());
      expect(await screen.findByText(GENERIC_ERROR)).toBeTruthy();
      expect(tab.location.href).toBe('');
      open.mockRestore();
    });
  });
});
