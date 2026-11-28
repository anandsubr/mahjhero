/**
 * The link preview for a Mahj Night (pivot batch 2), shared by the two
 * Vercel functions in api/. Pure: no React Native, no network.
 *
 * Built only from the event page's PUBLIC fields. The full address is never
 * among them, so it cannot reach a preview card, a crawler or a chat app's
 * cache.
 */

export type PublicNight = {
  title: string;
  host_first_name: string;
  starts_at: string;
  timezone: string;
  area: string;
  theme_id: string | null;
  status: string;
};

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "Fri, Dec 5 · 7:00 PM" in the night's own timezone. */
export function previewWhen(startsAt: string, timezone: string): string {
  const d = new Date(startsAt);
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone,
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone,
  }).format(d);
  return `${day} · ${time}`;
}

export function previewDescription(n: PublicNight): string {
  const parts = [
    n.host_first_name ? `Hosted by ${n.host_first_name}` : '',
    previewWhen(n.starts_at, n.timezone),
    n.area,
  ].filter(Boolean);
  const lead = n.status === 'cancelled' ? 'Cancelled. ' : '';
  return `${lead}${parts.join(' · ')}. RSVP on MahjHero.`;
}

/**
 * The tags injected into index.html's <head> for /e/<token>. `null` (an
 * unknown or switched-off link) gets a generic card that says nothing about
 * any night.
 */
export function previewTags(n: PublicNight | null, origin: string, token: string): string {
  const url = `${origin}/e/${encodeURIComponent(token)}`;
  const title = n ? n.title : 'A Mahj Night on MahjHero';
  const description = n ? previewDescription(n) : 'Host a mahj night. Keep the group going.';
  const tags = [
    `<meta name="robots" content="noindex, nofollow" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="MahjHero" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:url" content="${escapeAttr(url)}" />`,
    `<meta name="description" content="${escapeAttr(description)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
  ];
  if (n) {
    // The start time in the URL busts chat apps' image caches after an edit.
    const image = `${origin}/api/og/${encodeURIComponent(token)}?v=${encodeURIComponent(n.starts_at)}`;
    tags.push(
      `<meta property="og:image" content="${escapeAttr(image)}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:alt" content="${escapeAttr(`${title}, ${previewWhen(n.starts_at, n.timezone)}`)}" />`,
      `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
    );
  }
  return tags.join('\n    ');
}

/** index.html with its <title> replaced and the preview tags added to <head>. */
export function injectPreview(html: string, title: string, tags: string): string {
  const withTitle = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeAttr(title)}</title>`);
  return withTitle.replace('</head>', `    ${tags}\n  </head>`);
}
