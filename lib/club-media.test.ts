import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const uploadMock = vi.fn();
const removeMock = vi.fn();
const createSignedUrlsMock = vi.fn();
const fromTable = vi.fn();

vi.mock('./supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => fromTable(...a),
    rpc: (...a: unknown[]) => rpc(...a),
    storage: {
      from: vi.fn(() => ({
        upload: (...a: unknown[]) => uploadMock(...a),
        remove: (...a: unknown[]) => removeMock(...a),
        createSignedUrls: (...a: unknown[]) => createSignedUrlsMock(...a),
      })),
    },
  },
}));

const getDocumentAsync = vi.fn();
vi.mock('expo-document-picker', () => ({
  getDocumentAsync: (...a: unknown[]) => getDocumentAsync(...a),
}));

let uuidN = 0;
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => `uuid-${++uuidN}`) }));

vi.mock('./attachments', () => ({
  compressImage: vi.fn(async (image: unknown) => image),
}));

import {
  fetchClubMedia,
  fileTypeAllowed,
  fileTypeLabel,
  formatBytes,
  getMediaUrls,
  pickClubFile,
  removeClubMedia,
  sanitiseFileName,
  uploadClubFile,
  uploadClubPhotos,
} from './club-media';

const IMG = (n: number) => ({ uri: `file://${n}.jpg`, width: 800, height: 600 });
const MB = 1024 * 1024;

beforeEach(() => {
  rpc.mockReset();
  uploadMock.mockReset();
  removeMock.mockReset();
  createSignedUrlsMock.mockReset();
  fromTable.mockReset();
  getDocumentAsync.mockReset();
  uuidN = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
});

describe('pure helpers', () => {
  it('sanitiseFileName replaces disallowed characters per code point', () => {
    expect(sanitiseFileName('Ré sumé/✓ v2.pdf')).toBe('R__sum____v2.pdf');
    expect(sanitiseFileName('a 😀 b.txt')).toBe('a___b.txt');
  });
  it('sanitiseFileName collapses runs of dots (server rejects "..")', () => {
    expect(sanitiseFileName('a..b...c.pdf')).toBe('a.b.c.pdf');
    expect(sanitiseFileName('../../etc.pdf')).not.toContain('..');
  });
  it('sanitiseFileName caps at 100 chars, keeping the extension', () => {
    const out = sanitiseFileName(`${'x'.repeat(200)}.pdf`);
    expect(out).toHaveLength(100);
    expect(out.endsWith('.pdf')).toBe(true);
  });
  it('sanitiseFileName never reintroduces ".." when truncating', () => {
    const out = sanitiseFileName(`${'a'.repeat(95)}.${'b'.repeat(10)}.pdf`);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).not.toContain('..');
    expect(out.endsWith('.pdf')).toBe(true);
    const out2 = sanitiseFileName(`${'a'.repeat(96)}.${'b'.repeat(10)}.pdf`);
    expect(out2).not.toContain('..');
  });
  it('sanitiseFileName gives an emoji-only name a non-empty valid result', () => {
    const out = sanitiseFileName('😀');
    expect(out).toBe('_');
  });
  it('fileTypeLabel', () => {
    expect(fileTypeLabel('a.PDF')).toBe('PDF');
    expect(fileTypeLabel('a.docx')).toBe('DOC');
    expect(fileTypeLabel('a.xlsx')).toBe('XLS');
    expect(fileTypeLabel('a.pptx')).toBe('PPT');
    expect(fileTypeLabel('a.csv')).toBe('CSV');
    expect(fileTypeLabel('a.txt')).toBe('TXT');
    expect(fileTypeLabel('a.zip')).toBe('FILE');
  });
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(120 * 1024)).toBe('120 KB');
    expect(formatBytes(1.4 * MB)).toBe('1.4 MB');
    expect(formatBytes(10 * MB)).toBe('10 MB');
  });
  it('fileTypeAllowed goes by extension', () => {
    expect(fileTypeAllowed('a.pdf', 'application/pdf')).toBe(true);
    expect(fileTypeAllowed('a.csv', 'text/comma-separated-values')).toBe(true);
    expect(fileTypeAllowed('a.csv', '')).toBe(true);
    expect(fileTypeAllowed('a.exe', 'application/pdf')).toBe(false);
    expect(fileTypeAllowed('noext', 'application/pdf')).toBe(false);
    expect(fileTypeAllowed('a.pdf', 'image/png')).toBe(false);
  });
});

describe('fetchClubMedia', () => {
  it('lists through fetch_club_media and maps rows with uploader_name', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: 'm1', club_id: 'c1', kind: 'photo', storage_path: 'c1/photos/a.jpg',
          file_name: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 5, width: 10, height: 20,
          uploaded_by: 'u1', uploader_name: 'Ann', created_at: '2026-10-01T00:00:00Z',
        },
        {
          id: 'm2', club_id: 'c1', kind: 'photo', storage_path: 'c1/photos/b.jpg',
          file_name: 'b.jpg', mime_type: 'image/jpeg', size_bytes: 6, width: null, height: null,
          uploaded_by: 'u2', uploader_name: null, created_at: '2026-09-30T00:00:00Z',
        },
      ],
      error: null,
    });
    const rows = await fetchClubMedia('c1', 'photo', '2026-10-02T00:00:00Z', 30);
    expect(fromTable).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('fetch_club_media', {
      target_club: 'c1',
      p_kind: 'photo',
      p_before: '2026-10-02T00:00:00Z',
      p_limit: 30,
    });
    expect(rows).toEqual([
      {
        id: 'm1', clubId: 'c1', kind: 'photo', storagePath: 'c1/photos/a.jpg',
        fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 5, width: 10, height: 20,
        uploadedBy: 'u1', uploaderName: 'Ann', createdAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'm2', clubId: 'c1', kind: 'photo', storagePath: 'c1/photos/b.jpg',
        fileName: 'b.jpg', mimeType: 'image/jpeg', sizeBytes: 6, width: null, height: null,
        uploadedBy: 'u2', uploaderName: 'Someone', createdAt: '2026-09-30T00:00:00Z',
      },
    ]);
  });
  it('defaults limit to 60, sends a null cursor without one, null on error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await fetchClubMedia('c1', 'file')).toBeNull();
    expect(rpc).toHaveBeenCalledWith('fetch_club_media', {
      target_club: 'c1',
      p_kind: 'file',
      p_before: null,
      p_limit: 60,
    });
  });
  it('returns null when the RPC throws', async () => {
    rpc.mockRejectedValue(new Error('network'));
    expect(await fetchClubMedia('c1', 'photo')).toBeNull();
  });
});

describe('uploadClubPhotos', () => {
  it('uploads each photo without upsert and registers it', async () => {
    uploadMock.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ data: 'id', error: null });
    const progress = vi.fn();
    const res = await uploadClubPhotos('c1', [IMG(1), IMG(2)], progress);
    expect(res).toEqual({ added: 2, errors: [] });
    expect(uploadMock).toHaveBeenCalledWith('c1/photos/uuid-1.jpg', expect.anything(), {
      contentType: 'image/jpeg',
    });
    expect(rpc).toHaveBeenCalledWith('add_club_media', {
      target_club: 'c1', p_kind: 'photo', p_storage_path: 'c1/photos/uuid-1.jpg',
      p_file_name: 'uuid-1.jpg', p_mime_type: 'image/jpeg', p_size_bytes: 8,
      p_width: 800, p_height: 600,
    });
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });
  it('one failed upload does not stop the others and is reported', async () => {
    uploadMock
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'boom' } })
      .mockResolvedValueOnce({ error: null });
    rpc.mockResolvedValue({ data: 'id', error: null });
    const res = await uploadClubPhotos('c1', [IMG(1), IMG(2), IMG(3)]);
    expect(res.added).toBe(2);
    expect(res.errors).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it('removes the uploaded object when add_club_media fails', async () => {
    uploadMock.mockResolvedValue({ error: null });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'invalid_path' } });
    removeMock.mockResolvedValue({ error: null });
    const res = await uploadClubPhotos('c1', [IMG(1)]);
    expect(res.added).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(removeMock).toHaveBeenCalledWith(['c1/photos/uuid-1.jpg']);
  });
});

describe('pickClubFile / uploadClubFile', () => {
  it('pickClubFile maps the asset, null on cancel', async () => {
    getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file://x', name: 'Menu.pdf', mimeType: 'application/pdf', size: 99 }],
    });
    expect(await pickClubFile()).toEqual({
      uri: 'file://x', name: 'Menu.pdf', mimeType: 'application/pdf', size: 99,
    });
    getDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await pickClubFile()).toBeNull();
  });
  it('refuses disallowed types with exact copy and no network', async () => {
    const r = await uploadClubFile('c1', { uri: 'u', name: 'a.exe', mimeType: 'x', size: 5 });
    expect(r.error).toBe("That file type isn't supported.");
    expect(fetch).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('refuses oversized files with exact copy and no network', async () => {
    const r = await uploadClubFile('c1', {
      uri: 'u', name: 'a.pdf', mimeType: 'application/pdf', size: 10 * MB + 1,
    });
    expect(r.error).toBe('Files can be up to 10 MB.');
    expect(fetch).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });
  it('uploads to a sanitised path, sends canonical mime and the original name', async () => {
    uploadMock.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ data: 'id', error: null });
    const r = await uploadClubFile('c1', {
      uri: 'u', name: 'Ré sumé/✓ v2.PDF', mimeType: 'application/octet-stream', size: 1000,
    });
    expect(r.error).toBeNull();
    expect(uploadMock).toHaveBeenCalledWith(
      'c1/files/uuid-1/R__sum____v2.PDF',
      expect.anything(),
      { contentType: 'application/pdf' },
    );
    expect(rpc).toHaveBeenCalledWith('add_club_media', {
      target_club: 'c1', p_kind: 'file', p_storage_path: 'c1/files/uuid-1/R__sum____v2.PDF',
      p_file_name: 'Ré sumé/✓ v2.PDF', p_mime_type: 'application/pdf', p_size_bytes: 8,
      p_width: null, p_height: null,
    });
  });
  it('removes the object when the RPC throws', async () => {
    uploadMock.mockResolvedValue({ error: null });
    rpc.mockRejectedValue(new Error('network'));
    removeMock.mockResolvedValue({ error: null });
    const r = await uploadClubFile('c1', { uri: 'u', name: 'a.txt', mimeType: 'text/plain', size: 3 });
    expect(r.error).not.toBeNull();
    expect(removeMock).toHaveBeenCalledWith(['c1/files/uuid-1/a.txt']);
  });
  it('removes the object when the RPC fails', async () => {
    uploadMock.mockResolvedValue({ error: null });
    rpc.mockResolvedValue({ data: null, error: { message: 'file_not_allowed' } });
    removeMock.mockResolvedValue({ error: null });
    const r = await uploadClubFile('c1', { uri: 'u', name: 'a.txt', mimeType: 'text/plain', size: 3 });
    expect(r.error).not.toBeNull();
    expect(removeMock).toHaveBeenCalledWith(['c1/files/uuid-1/a.txt']);
  });
});

describe('removeClubMedia', () => {
  const media = { id: 'm1' } as Parameters<typeof removeClubMedia>[0];
  it('calls the RPC then removes the returned path', async () => {
    rpc.mockResolvedValue({ data: 'c1/photos/a.jpg', error: null });
    removeMock.mockResolvedValue({ error: { message: 'ignored' } });
    expect(await removeClubMedia(media)).toEqual({ error: null });
    expect(rpc).toHaveBeenCalledWith('remove_club_media', { media_id: 'm1' });
    expect(removeMock).toHaveBeenCalledWith(['c1/photos/a.jpg']);
  });
  it('does not touch storage when the RPC refuses', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not allowed', code: '42501' } });
    const r = await removeClubMedia(media);
    expect(r.error).not.toBeNull();
    expect(removeMock).not.toHaveBeenCalled();
  });
});

describe('getMediaUrls', () => {
  it('batches, caches, and refetches shortly before the TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T00:00:00Z'));
    createSignedUrlsMock.mockImplementation(async (paths: string[]) => ({
      data: paths.map((p) => ({ path: p, signedUrl: `https://s/${p}`, error: null })),
      error: null,
    }));
    const a = await getMediaUrls(['p1', 'p2']);
    expect(a).toEqual({ p1: 'https://s/p1', p2: 'https://s/p2' });
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1);
    await getMediaUrls(['p1', 'p2']);
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(56 * 60 * 1000); // within 5 min of the 1h TTL
    await getMediaUrls(['p1']);
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
