import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();
const createSignedUrlMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    storage: {
      from: vi.fn(() => ({
        upload: (...a: unknown[]) => uploadMock(...a),
        remove: (...a: unknown[]) => removeMock(...a),
        createSignedUrl: (...a: unknown[]) => createSignedUrlMock(...a),
      })),
    },
  },
}));

vi.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  launchCameraAsync: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
}));

vi.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: vi.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}));

vi.mock('./attachments', () => ({
  compressImage: vi.fn(async (image: unknown) => image),
}));

import { getClubCoverUrl, removeClubCover, setClubCoverColor, uploadClubCover } from './club-cover';

const IMAGE = { uri: 'file://a.jpg', width: 100, height: 100 };

beforeEach(() => {
  rpc.mockReset();
  uploadMock.mockReset();
  removeMock.mockReset();
  createSignedUrlMock.mockReset();
  global.fetch = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
});

describe('uploadClubCover', () => {
  it('compresses, uploads, sets the cover, and removes the previous path', async () => {
    uploadMock.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: 'c1/old-uuid.jpg', error: null });
    removeMock.mockResolvedValueOnce({ error: null });

    const result = await uploadClubCover('c1', IMAGE);

    expect(uploadMock).toHaveBeenCalledWith(
      'c1/test-uuid.jpg',
      expect.anything(),
      { contentType: 'image/jpeg' },
    );
    expect(rpc).toHaveBeenCalledWith('set_club_cover', {
      target_club: 'c1',
      new_path: 'c1/test-uuid.jpg',
    });
    expect(removeMock).toHaveBeenCalledWith(['c1/old-uuid.jpg']);
    expect(result).toEqual({ error: null });
  });

  it('does not try to remove when there was no previous cover', async () => {
    uploadMock.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await uploadClubCover('c1', IMAGE);

    expect(removeMock).not.toHaveBeenCalled();
    expect(result).toEqual({ error: null });
  });

  it('ignores a failed removal of the previous cover', async () => {
    uploadMock.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: 'c1/old-uuid.jpg', error: null });
    removeMock.mockResolvedValueOnce({ error: { message: 'nope' } });

    const result = await uploadClubCover('c1', IMAGE);

    expect(result).toEqual({ error: null });
  });

  it('returns an error when the upload fails', async () => {
    uploadMock.mockResolvedValueOnce({ error: { message: 'nope' } });
    const result = await uploadClubCover('c1', IMAGE);
    expect(result.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns an error when set_club_cover fails', async () => {
    uploadMock.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    const result = await uploadClubCover('c1', IMAGE);
    expect(result.error).toBeTruthy();
  });

  it('removes the just-uploaded object when set_club_cover fails after a successful upload', async () => {
    uploadMock.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    removeMock.mockResolvedValueOnce({ error: null });

    const result = await uploadClubCover('c1', IMAGE);

    expect(removeMock).toHaveBeenCalledWith(['c1/test-uuid.jpg']);
    expect(result.error).toBeTruthy();
  });

  it('still reports the set_club_cover error when the cleanup removal itself fails', async () => {
    uploadMock.mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    removeMock.mockResolvedValueOnce({ error: { message: 'cleanup failed too' } });

    const result = await uploadClubCover('c1', IMAGE);

    expect(result.error).toBeTruthy();
  });
});

describe('removeClubCover', () => {
  it('calls set_club_cover with a null path', async () => {
    rpc.mockResolvedValueOnce({ data: 'c1/old.jpg', error: null });
    removeMock.mockResolvedValueOnce({ error: null });
    const result = await removeClubCover('c1');
    expect(rpc).toHaveBeenCalledWith('set_club_cover', { target_club: 'c1', new_path: null });
    expect(removeMock).toHaveBeenCalledWith(['c1/old.jpg']);
    expect(result).toEqual({ error: null });
  });

  it('returns an error on failure', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    const result = await removeClubCover('c1');
    expect(result.error).toBeTruthy();
  });
});

describe('setClubCoverColor', () => {
  it('calls set_club_cover_color', async () => {
    rpc.mockResolvedValueOnce({ error: null });
    const result = await setClubCoverColor('c1', 'accent_700');
    expect(rpc).toHaveBeenCalledWith('set_club_cover_color', {
      target_club: 'c1',
      new_color: 'accent_700',
    });
    expect(result).toEqual({ error: null });
  });

  it('returns an error on failure', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'nope' } });
    const result = await setClubCoverColor('c1', 'accent_700');
    expect(result.error).toBeTruthy();
  });
});

describe('getClubCoverUrl', () => {
  it('requests a signed URL good for an hour', async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: 'https://example.com/cover.jpg' },
      error: null,
    });
    const url = await getClubCoverUrl('c1/a.jpg');
    expect(createSignedUrlMock).toHaveBeenCalledWith('c1/a.jpg', 3600);
    expect(url).toBe('https://example.com/cover.jpg');
  });

  it('caches a path already resolved and does not re-request it', async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: 'https://example.com/b.jpg' },
      error: null,
    });
    await getClubCoverUrl('c1/b.jpg');
    createSignedUrlMock.mockReset();
    const url = await getClubCoverUrl('c1/b.jpg');
    expect(createSignedUrlMock).not.toHaveBeenCalled();
    expect(url).toBe('https://example.com/b.jpg');
  });

  it('returns null on failure', async () => {
    createSignedUrlMock.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    expect(await getClubCoverUrl('c1/missing.jpg')).toBeNull();
  });
});
