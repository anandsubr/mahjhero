import { describe, expect, it } from 'vitest';
import { injectPreview, previewDescription, previewTags, type PublicNight } from './night-meta';

const NIGHT: PublicNight = {
  title: 'Ellie\'s "big" night',
  host_first_name: 'Priya',
  starts_at: '2026-12-05T00:00:00Z',
  timezone: 'America/New_York',
  area: 'Suwanee',
  theme_id: 'jade',
  status: 'published',
};

describe('the link preview', () => {
  it('describes the night from public fields only', () => {
    expect(previewDescription(NIGHT)).toBe('Hosted by Priya · Fri, Dec 4 · 7:00 PM · Suwanee. RSVP on MahjHero.');
  });

  it('escapes the title and points og:image at this night', () => {
    const tags = previewTags(NIGHT, 'https://app.mahjhero.com', 'tok');
    expect(tags).toContain('content="Ellie&#39;s &quot;big&quot; night"');
    expect(tags).toContain('https://app.mahjhero.com/api/og/tok?v=');
    expect(tags).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it('says nothing about any night for an unknown link', () => {
    const tags = previewTags(null, 'https://app.mahjhero.com', 'tok');
    expect(tags).toContain('A Mahj Night on MahjHero');
    expect(tags).not.toContain('og:image');
  });

  it('replaces the title and adds the tags inside head', () => {
    const html = '<html><head><title>MahjHero</title></head><body></body></html>';
    const out = injectPreview(html, 'Friday <Mahj>', '<meta name="x" />');
    expect(out).toContain('<title>Friday &lt;Mahj&gt;</title>');
    expect(out.indexOf('<meta name="x" />')).toBeLessThan(out.indexOf('</head>'));
  });
});
