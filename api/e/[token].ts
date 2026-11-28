import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { injectPreview, previewTags } from '../../lib/night-meta';
import { fetchPublicNight } from '../_night';

/**
 * /e/<token> (rewritten here by vercel.json): the app's own index.html with
 * this night's link-preview tags in <head>, so iMessage, WhatsApp and
 * Instagram show the night instead of a bare "MahjHero". The browser then
 * boots the app as usual and app/e/[token].tsx takes over.
 *
 * index.html is bundled into this function (vercel.json includeFiles)
 * rather than fetched over HTTP, which a protected preview deployment would
 * refuse.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  const origin = `${url.protocol}//${url.host}`;

  let html: string;
  try {
    html = await readFile(join(process.cwd(), 'dist', 'index.html'), 'utf8');
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const night = await fetchPublicNight(token);
  const page = injectPreview(html, night?.title ?? 'MahjHero', previewTags(night, origin, token));

  return new Response(page, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
      // Short: an edited night should show its new details soon.
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
