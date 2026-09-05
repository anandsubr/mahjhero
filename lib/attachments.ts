import * as Crypto from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

const BUCKET = 'message-images';

/**
 * How many images a single message may carry. Mirrors post_message's own
 * bound. The one export of this name in the app -- lib/messages.ts used to
 * keep a second, same-named, same-valued copy (nothing ever imported it),
 * which was a drift hazard rather than a real second source of truth, and
 * was removed. `postMessage` (lib/messages.ts) does not import this one
 * either, on purpose -- see that function's own comment on why pulling
 * anything from this module into lib/messages.ts is more than it looks
 * like.
 */
export const MAX_ATTACHMENTS = 4;

/** The long edge a compressed upload is resized to, and its JPEG quality. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

/** How long a signed URL lives before it must be re-requested. */
const SIGNED_URL_TTL_SECONDS = 3600;

export type PickedImage = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Opens the system library or camera picker. Returns `null` on cancel or a
 * denied permission -- never throws, matching this module's own "never
 * rejects" contract (lib/messages.ts's decision #9, applied here too).
 *
 * Multi-select only applies to the library: a single camera capture is one
 * photo, so `selectionLimit` is meaningless there.
 */
export async function pickImages(
  source: 'camera' | 'library',
  alreadyPicked: number,
): Promise<PickedImage[] | null> {
  const remaining = MAX_ATTACHMENTS - alreadyPicked;
  if (remaining <= 0) return null;

  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return null;
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled || result.assets.length === 0) return null;
      const a = result.assets[0];
      return [{ uri: a.uri, width: a.width, height: a.height }];
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return null;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
    });
    if (result.canceled) return null;
    // `selectionLimit` above is honoured on native, but expo-image-picker's
    // WEB implementation ignores it outright -- it sets `multiple` on a
    // plain `<input type="file">` and returns every file the member
    // selected, unclamped. Web is a first-class platform for this app, so
    // without this slice a member could pick more than `remaining` images,
    // all of which would be compressed and uploaded before `post_message`
    // ever gets a say, only to have the whole send refused for carrying too
    // many attachments -- orphaning the extra uploads for nothing. Clamping
    // here, once, covers both platforms: a no-op on native (which already
    // returns at most `remaining`), the actual fix on web.
    return result.assets
      .slice(0, remaining)
      .map((a) => ({ uri: a.uri, width: a.width, height: a.height }));
  } catch (cause) {
    console.error('pickImages failed', cause);
    return null;
  }
}

/**
 * Resizes to a 1600px long edge and re-encodes as JPEG at 0.8 quality
 * before upload -- a modern phone photo can be 5-15MB, and nothing about
 * this app's realtime-driven UI wants to move that much data per message.
 * A source already smaller than the long edge is not upscaled.
 */
export async function compressImage(image: PickedImage): Promise<PickedImage> {
  const longEdge = Math.max(image.width, image.height);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  const context = ImageManipulator.manipulate(image.uri);
  if (scale < 1) {
    context.resize({
      width: Math.round(image.width * scale),
      height: Math.round(image.height * scale),
    });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/**
 * Uploads one already-compressed image to `{threadId}/{uuid}.jpg`. The
 * storage INSERT policy (20260905030000) is what actually enforces that
 * only a member of this thread can write here -- this function does not
 * duplicate that check, it just names the path the policy expects.
 */
export async function uploadAttachment(
  threadId: string,
  image: PickedImage,
): Promise<{ storagePath: string | null; error: string | null }> {
  try {
    const path = `${threadId}/${Crypto.randomUUID()}.jpg`;
    const response = await fetch(image.uri);
    const bytes = await response.arrayBuffer();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg' });
    if (error) return { storagePath: null, error: error.message };
    return { storagePath: path, error: null };
  } catch (cause) {
    console.error('uploadAttachment failed', cause);
    return { storagePath: null, error: GENERIC_ERROR };
  }
}

// Session-lifetime cache, keyed by storage path. A signed URL is only ever
// re-requested once its own TTL has elapsed -- not on every render, and not
// once per image, since getSignedUrls always batches.
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Batches every path into ONE createSignedUrls call rather than one request
 * per image -- a thread screen with a dozen visible attachments would
 * otherwise fire a dozen round trips on every load.
 */
export async function getSignedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const result: Record<string, string> = {};
  const toFetch: string[] = [];

  for (const path of paths) {
    const cached = signedUrlCache.get(path);
    if (cached && cached.expiresAt > now) {
      result[path] = cached.url;
    } else {
      toFetch.push(path);
    }
  }

  if (toFetch.length === 0) return result;

  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(toFetch, SIGNED_URL_TTL_SECONDS);
    if (error || !data) {
      console.error('getSignedUrls failed', error);
      return result;
    }
    for (const row of data) {
      if (!row.signedUrl) continue;
      signedUrlCache.set(row.path ?? '', {
        url: row.signedUrl,
        expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000,
      });
      result[row.path ?? ''] = row.signedUrl;
    }
    return result;
  } catch (cause) {
    console.error('getSignedUrls failed', cause);
    return result;
  }
}
