import { ImageResponse } from '@vercel/og';
import { previewWhen } from '../../lib/night-meta';
import { nightTheme } from '../../lib/themes';
import { fetchPublicNight } from '../_night';

/**
 * The 1200×630 link-preview image for a Mahj Night: the theme's tiles, the
 * night's name, the date and the area. The same picture as
 * components/night/ThemeArt.tsx, drawn for satori. Public fields only --
 * never the address.
 *
 * Plain element objects rather than JSX, so this function needs no JSX
 * transform from whatever compiles api/.
 */
type El = { type: string; key?: string; props: Record<string, unknown> };

function div(style: Record<string, unknown>, ...children: (El | string | null)[]): El {
  const kids = children.filter((c) => c !== null);
  return {
    type: 'div',
    props: { style: { display: 'flex', ...style }, children: kids.length === 1 ? kids[0] : kids },
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  const night = await fetchPublicNight(token);
  const theme = nightTheme(night?.theme_id);

  const rawTitle = night?.title ?? 'A Mahj Night';
  const title = rawTitle.length > 60 ? `${rawTitle.slice(0, 57)}…` : rawTitle;
  const when = night ? previewWhen(night.starts_at, night.timezone) : '';
  const sub = [night?.host_first_name ? `Hosted by ${night.host_first_name}` : '', night?.area ?? '']
    .filter(Boolean)
    .join(' · ');

  const mark =
    theme.motif === 'bamboo'
      ? div(
          { gap: 10 },
          div({ width: 13, height: 72, borderRadius: 13, background: theme.mark }),
          div({ width: 13, height: 72, borderRadius: 13, background: theme.mark }),
        )
      : div({ width: 44, height: 44, borderRadius: 44, border: `9px solid ${theme.mark}` });

  const tiles = [0, 1, 2, 3].map((i) =>
    div(
      {
        width: 96,
        height: 130,
        borderRadius: 16,
        background: theme.tile,
        borderBottom: `12px solid ${theme.tileEdge}`,
        alignItems: 'center',
        justifyContent: 'center',
        transform: `rotate(${(i - 1.5) * 6}deg) translateY(${Math.abs(i - 1.5) * 10}px)`,
      },
      mark,
    ),
  );

  const tree = div(
    {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      justifyContent: 'space-between',
      background: theme.bg,
      color: theme.ink,
      padding: '56px 72px',
    },
    { type: 'div', props: { style: { display: 'flex', gap: 22 }, children: tiles } },
    div(
      { flexDirection: 'column', gap: 12 },
      div({ fontSize: 68, fontWeight: 700, lineHeight: 1.05 }, title),
      when ? div({ fontSize: 38 }, when) : null,
      sub ? div({ fontSize: 30, opacity: 0.85 }, sub) : null,
      div({ fontSize: 26, opacity: 0.75, marginTop: 8 }, 'MahjHero · RSVP inside'),
    ),
  );

  return new ImageResponse(tree as never, {
    width: 1200,
    height: 630,
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'X-Robots-Tag': 'noindex',
    },
  });
}
