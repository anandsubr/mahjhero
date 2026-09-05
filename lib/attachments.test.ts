import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSignedUrlsMock = vi.fn();
const uploadMock = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        createSignedUrls: (...args: unknown[]) => createSignedUrlsMock(...args),
        upload: (...args: unknown[]) => uploadMock(...args),
      })),
    },
  },
}));

// expo-image-picker, expo-image-manipulator and expo-crypto all transitively
// pull in expo-modules-core, which expects a native `expo` global that does
// not exist under Vitest/Node — importing them for real crashes at module
// load, the same failure mode documented in lib/auth.test.ts for
// expo-linking/expo-web-browser. Stubbed here so this file (and any file
// importing ./attachments) can load; none of these tests exercise
// pickImages/compressImage, which are validated by `tsc` instead (see
// lib/attachments.ts's own header comment / the task report).
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

import * as ImagePicker from 'expo-image-picker';
import { getSignedUrls, MAX_ATTACHMENTS, pickImages } from './attachments';

describe('getSignedUrls', () => {
  beforeEach(() => {
    createSignedUrlsMock.mockReset();
  });

  it('requests every path in one batched call', async () => {
    createSignedUrlsMock.mockResolvedValueOnce({
      data: [
        { path: 't1/a.jpg', signedUrl: 'https://example.com/a', error: null },
        { path: 't1/b.jpg', signedUrl: 'https://example.com/b', error: null },
      ],
      error: null,
    });
    const urls = await getSignedUrls(['t1/a.jpg', 't1/b.jpg']);
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1);
    expect(createSignedUrlsMock).toHaveBeenCalledWith(['t1/a.jpg', 't1/b.jpg'], 3600);
    expect(urls).toEqual({
      't1/a.jpg': 'https://example.com/a',
      't1/b.jpg': 'https://example.com/b',
    });
  });

  it('caches a path already resolved this session and does not re-request it', async () => {
    // Uses its own paths (t2/*, not t1/* from the previous test) because
    // signedUrlCache is module-level state that Vitest does not reset
    // between tests in the same file -- reusing a path already cached by
    // an earlier test would make this test's own "prime the cache" call a
    // cache hit instead of a call to the mock, desyncing the mockResolvedValueOnce
    // queue from actual invocations.
    createSignedUrlsMock.mockResolvedValueOnce({
      data: [{ path: 't2/a.jpg', signedUrl: 'https://example.com/a', error: null }],
      error: null,
    });
    await getSignedUrls(['t2/a.jpg']);
    createSignedUrlsMock.mockResolvedValueOnce({
      data: [{ path: 't2/c.jpg', signedUrl: 'https://example.com/c', error: null }],
      error: null,
    });
    const urls = await getSignedUrls(['t2/a.jpg', 't2/c.jpg']);
    expect(createSignedUrlsMock).toHaveBeenLastCalledWith(['t2/c.jpg'], 3600);
    expect(urls).toEqual({
      't2/a.jpg': 'https://example.com/a',
      't2/c.jpg': 'https://example.com/c',
    });
  });

  it('returns an empty map rather than throwing on failure', async () => {
    createSignedUrlsMock.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    await expect(getSignedUrls(['t1/missing.jpg'])).resolves.toEqual({});
  });
});

describe('MAX_ATTACHMENTS', () => {
  it('is 4, mirroring post_message’s own bound', () => {
    expect(MAX_ATTACHMENTS).toBe(4);
  });
});

describe('pickImages', () => {
  // expo-image-picker's WEB implementation ignores `selectionLimit`
  // entirely -- it just sets `multiple` on an `<input type="file">` and
  // returns every file the member selected. Native honours the limit, so
  // this can only be reproduced by making the picker itself misbehave, the
  // same way a real web picker would: `remaining` is 2, but the picker
  // hands back 4 assets anyway. Without a clamp at the call site, all 4
  // would be compressed and uploaded before `post_message` ever gets a say.
  it('clamps the library result to `remaining` even when the picker returns more', async () => {
    vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValueOnce({
      granted: true,
    } as ImagePicker.PermissionResponse);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        { uri: 'a', width: 1, height: 1 },
        { uri: 'b', width: 2, height: 2 },
        { uri: 'c', width: 3, height: 3 },
        { uri: 'd', width: 4, height: 4 },
      ],
    } as ImagePicker.ImagePickerResult);

    const picked = await pickImages('library', /* alreadyPicked */ 2);

    expect(picked).toEqual([
      { uri: 'a', width: 1, height: 1 },
      { uri: 'b', width: 2, height: 2 },
    ]);
  });

  it('passes the full result through untouched when the picker already honours the limit', async () => {
    vi.mocked(ImagePicker.requestMediaLibraryPermissionsAsync).mockResolvedValueOnce({
      granted: true,
    } as ImagePicker.PermissionResponse);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'a', width: 1, height: 1 }],
    } as ImagePicker.ImagePickerResult);

    const picked = await pickImages('library', 0);

    expect(picked).toEqual([{ uri: 'a', width: 1, height: 1 }]);
  });
});
