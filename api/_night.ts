import type { PublicNight } from '../lib/night-meta';

/**
 * The public view of a night, from the `mahj-night` edge function: the same
 * door the app uses, with no viewer, so only public fields come back.
 * Underscore-prefixed, so Vercel bundles it but never serves it.
 */
export async function fetchPublicNight(token: string): Promise<PublicNight | null> {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  try {
    const res = await fetch(`${base}/functions/v1/mahj-night?token=${encodeURIComponent(token)}`, {
      headers: { apikey: key },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { page?: PublicNight };
    return body.page ?? null;
  } catch {
    return null;
  }
}
