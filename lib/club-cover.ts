import * as Crypto from 'expo-crypto';
import { compressImage, type PickedImage } from './attachments';
import type { CoverColor } from './club-hub';
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

const BUCKET = 'club-covers';

/** How long a signed URL lives before it must be re-requested. */
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Uploads a new cover photo for a club, at `{clubId}/{uuid}.jpg` — the path
 * shape `set_club_cover` requires. `set_club_cover` returns the previous
 * path (or null, for a club with no prior cover), which is then removed
 * from storage; there is no storage UPDATE policy on this bucket, so a
 * stale photo would otherwise never be cleaned up. The removal failing is
 * not surfaced as an error — the new cover is already live either way, and
 * an orphaned object is a cheap trade for not blocking the member on a
 * cleanup step.
 */
export async function uploadClubCover(
  clubId: string,
  image: PickedImage,
): Promise<{ error: string | null }> {
  try {
    const compressed = await compressImage(image);
    const path = `${clubId}/${Crypto.randomUUID()}.jpg`;
    const response = await fetch(compressed.uri);
    const bytes = await response.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg' });
    if (uploadError) {
      console.error('uploadClubCover failed', uploadError);
      return { error: GENERIC_ERROR };
    }

    const { data: previous, error } = await supabase.rpc('set_club_cover', {
      target_club: clubId,
      new_path: path,
    });
    if (error) {
      console.error('uploadClubCover failed', error);
      return { error: GENERIC_ERROR };
    }

    if (previous) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([previous]);
      if (removeError) console.error('uploadClubCover: removing previous cover failed', removeError);
    }

    return { error: null };
  } catch (cause) {
    console.error('uploadClubCover failed', cause);
    return { error: GENERIC_ERROR };
  }
}

/** Clears a club's cover photo, reverting it to its cover colour. */
export async function removeClubCover(clubId: string): Promise<{ error: string | null }> {
  try {
    const { data: previous, error } = await supabase.rpc('set_club_cover', {
      target_club: clubId,
      new_path: null,
    });
    if (error) {
      console.error('removeClubCover failed', error);
      return { error: GENERIC_ERROR };
    }
    if (previous) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([previous]);
      if (removeError) console.error('removeClubCover: removing previous cover failed', removeError);
    }
    return { error: null };
  } catch (cause) {
    console.error('removeClubCover failed', cause);
    return { error: GENERIC_ERROR };
  }
}

export async function setClubCoverColor(
  clubId: string,
  color: CoverColor,
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase.rpc('set_club_cover_color', {
      target_club: clubId,
      new_color: color,
    });
    if (error) {
      console.error('setClubCoverColor failed', error);
      return { error: GENERIC_ERROR };
    }
    return { error: null };
  } catch (cause) {
    console.error('setClubCoverColor failed', cause);
    return { error: GENERIC_ERROR };
  }
}

// Session-lifetime cache, keyed by storage path — same approach as
// getSignedUrls in lib/attachments.ts, sized down to one path per call
// since a club hub only ever shows its own single cover at a time.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export async function getClubCoverUrl(path: string): Promise<string | null> {
  const now = Date.now();
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > now) return cached.url;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      console.error('getClubCoverUrl failed', error);
      return null;
    }
    signedUrlCache.set(path, {
      url: data.signedUrl,
      expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000,
    });
    return data.signedUrl;
  } catch (cause) {
    console.error('getClubCoverUrl failed', cause);
    return null;
  }
}
