import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { compressImage, type PickedImage } from './attachments';
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

const BUCKET = 'club-media';

/** Photos per batch. */
export const MAX_PHOTOS_PER_BATCH = 10;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_NAME_LENGTH = 100;

/** Signed URLs live an hour; the cache lets go of them 5 minutes early. */
const SIGNED_URL_TTL_SECONDS = 3600;
const CACHE_SAFETY_MS = 5 * 60 * 1000;

export const FILE_TYPE_ERROR = "That file type isn't supported.";
export const FILE_SIZE_ERROR = 'Files can be up to 10 MB.';

export type ClubMedia = {
  id: string;
  clubId: string;
  kind: 'photo' | 'file';
  storagePath: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  uploadedBy: string;
  uploaderName: string;
  createdAt: string;
};

export type PickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
};

/** Canonical mime per allowed extension -- exactly what add_club_media accepts. */
const CANONICAL_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
};

const LABELS: Record<string, string> = {
  pdf: 'PDF', doc: 'DOC', docx: 'DOC', xls: 'XLS', xlsx: 'XLS',
  ppt: 'PPT', pptx: 'PPT', csv: 'CSV', txt: 'TXT',
};

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

/**
 * Keeps letters, digits, `.`, `-`, `_`; every other code point becomes one
 * `_` (so 'Ré sumé/✓ v2.pdf' -> 'R__sum____v2.pdf'). Runs of dots collapse
 * to one because add_club_media rejects any `..` in a path. Capped at 100
 * characters, truncating the base name so the extension survives.
 */
export function sanitiseFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/gu, '_').replace(/\.{2,}/g, '.');
  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 ? cleaned.slice(dot) : '';
  if (ext.length >= MAX_NAME_LENGTH) return cleaned.slice(0, MAX_NAME_LENGTH);
  const base = cleaned
    .slice(0, MAX_NAME_LENGTH - ext.length)
    .replace(/\.+$/, '');
  return (base + ext).replace(/\.{2,}/g, '.');
}

export function fileTypeLabel(name: string): string {
  return LABELS[extensionOf(name)] ?? 'FILE';
}

export function formatBytes(n: number): string {
  const mb = 1024 * 1024;
  // A non-empty file never reads as "0 KB".
  if (n < mb) return `${n > 0 ? Math.max(1, Math.round(n / 1024)) : 0} KB`;
  return `${Number((n / mb).toFixed(1))} MB`;
}

/**
 * The extension decides: pickers report inconsistent mime types (csv is
 * often 'application/vnd.ms-excel' or empty), and the canonical type is
 * derived from the extension on upload anyway. The reported mime is only
 * used to refuse an obvious mismatch (image/video/audio).
 */
export function fileTypeAllowed(name: string, mime: string | null | undefined): boolean {
  if (!(extensionOf(name) in CANONICAL_MIME)) return false;
  return !/^(image|video|audio)\//i.test(mime ?? '');
}

type Row = {
  id: string;
  club_id: string;
  kind: 'photo' | 'file';
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  uploaded_by: string;
  uploader_name: string | null;
  created_at: string;
};

export async function fetchClubMedia(
  clubId: string,
  kind: 'photo' | 'file',
  before?: string,
  limit = 60,
): Promise<ClubMedia[] | null> {
  try {
    // An RPC, not a PostgREST embed: profiles are readable only for the
    // caller's own row, so an embed would name every other uploader 'Someone'.
    const { data, error } = await supabase.rpc('fetch_club_media', {
      target_club: clubId,
      p_kind: kind,
      p_before: before ?? null,
      p_limit: limit,
    });
    if (error || !data) {
      console.error('fetchClubMedia failed', error);
      return null;
    }
    return (data as unknown as Row[]).map((r) => ({
      id: r.id,
      clubId: r.club_id,
      kind: r.kind,
      storagePath: r.storage_path,
      fileName: r.file_name,
      mimeType: r.mime_type,
      sizeBytes: r.size_bytes,
      width: r.width,
      height: r.height,
      uploadedBy: r.uploaded_by,
      uploaderName: r.uploader_name ?? 'Someone',
      createdAt: r.created_at,
    }));
  } catch (cause) {
    console.error('fetchClubMedia failed', cause);
    return null;
  }
}

/** Upload the bytes, then record them; if recording fails, delete the object. */
async function uploadAndRecord(
  clubId: string,
  path: string,
  bytes: ArrayBuffer,
  meta: {
    kind: 'photo' | 'file';
    fileName: string;
    mimeType: string;
    width: number | null;
    height: number | null;
  },
): Promise<{ error: string | null }> {
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: meta.mimeType });
  if (uploadError) {
    console.error('club media upload failed', uploadError);
    return { error: GENERIC_ERROR };
  }
  let rpcFailed = false;
  try {
    const { error } = await supabase.rpc('add_club_media', {
      target_club: clubId,
      p_kind: meta.kind,
      p_storage_path: path,
      p_file_name: meta.fileName,
      p_mime_type: meta.mimeType,
      p_size_bytes: bytes.byteLength,
      p_width: meta.width,
      p_height: meta.height,
    });
    if (error) {
      console.error('add_club_media failed', error);
      rpcFailed = true;
    }
  } catch (cause) {
    console.error('add_club_media threw', cause);
    rpcFailed = true;
  }
  if (rpcFailed) {
    try {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
      if (removeError) console.error('club media: removing the failed upload failed', removeError);
    } catch (cause) {
      console.error('club media: removing the failed upload threw', cause);
    }
    return { error: GENERIC_ERROR };
  }
  return { error: null };
}

/**
 * Sequentially compresses, uploads and records each photo. One failure does
 * not stop the rest; failures are reported in `errors`.
 */
export async function uploadClubPhotos(
  clubId: string,
  images: PickedImage[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ added: number; errors: string[] }> {
  let added = 0;
  const errors: string[] = [];
  for (let i = 0; i < images.length; i++) {
    try {
      const compressed = await compressImage(images[i]);
      const id = Crypto.randomUUID();
      const response = await fetch(compressed.uri);
      const bytes = await response.arrayBuffer();
      const { error } = await uploadAndRecord(clubId, `${clubId}/photos/${id}.jpg`, bytes, {
        kind: 'photo',
        fileName: `${id}.jpg`,
        mimeType: 'image/jpeg',
        width: compressed.width,
        height: compressed.height,
      });
      if (error) errors.push(error);
      else added += 1;
    } catch (cause) {
      console.error('uploadClubPhotos failed', cause);
      errors.push(GENERIC_ERROR);
    }
    onProgress?.(i + 1, images.length);
  }
  return { added, errors };
}

/** Opens the document picker. Null on cancel or failure; never throws. */
export async function pickClubFile(): Promise<PickedFile | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.length) return null;
    const a = result.assets[0];
    return { uri: a.uri, name: a.name, mimeType: a.mimeType ?? '', size: a.size ?? 0 };
  } catch (cause) {
    console.error('pickClubFile failed', cause);
    return null;
  }
}

export async function uploadClubFile(
  clubId: string,
  file: PickedFile,
): Promise<{ error: string | null }> {
  if (!fileTypeAllowed(file.name, file.mimeType)) return { error: FILE_TYPE_ERROR };
  if (file.size > MAX_FILE_BYTES) return { error: FILE_SIZE_ERROR };
  try {
    const response = await fetch(file.uri);
    const bytes = await response.arrayBuffer();
    // The server checks the actual byte count too, so re-check it here.
    if (bytes.byteLength > MAX_FILE_BYTES) return { error: FILE_SIZE_ERROR };
    const path = `${clubId}/files/${Crypto.randomUUID()}/${sanitiseFileName(file.name)}`;
    return await uploadAndRecord(clubId, path, bytes, {
      kind: 'file',
      fileName: file.name,
      mimeType: CANONICAL_MIME[extensionOf(file.name)],
      width: null,
      height: null,
    });
  } catch (cause) {
    console.error('uploadClubFile failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/** Deletes the row (RPC), then the object at the path it returns. */
export async function removeClubMedia(media: ClubMedia): Promise<{ error: string | null }> {
  try {
    const { data: path, error } = await supabase.rpc('remove_club_media', {
      media_id: media.id,
    });
    if (error) {
      console.error('removeClubMedia failed', error);
      return { error: GENERIC_ERROR };
    }
    if (path) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([path as string]);
      if (removeError) console.error('removeClubMedia: removing the object failed', removeError);
    }
    return { error: null };
  } catch (cause) {
    console.error('removeClubMedia failed', cause);
    return { error: GENERIC_ERROR };
  }
}

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/** One batched createSignedUrls call for every path not already cached. */
export async function getMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const result: Record<string, string> = {};
  const toFetch: string[] = [];
  for (const path of paths) {
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > now) result[path] = cached.url;
    else toFetch.push(path);
  }
  if (toFetch.length === 0) return result;
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(toFetch, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      console.error('getMediaUrls failed', error);
      return result;
    }
    for (const row of data) {
      if (!row.signedUrl || !row.path) continue;
      signedUrlCache.set(row.path, {
        url: row.signedUrl,
        expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000 - CACHE_SAFETY_MS,
      });
      result[row.path] = row.signedUrl;
    }
    return result;
  } catch (cause) {
    console.error('getMediaUrls failed', cause);
    return result;
  }
}
