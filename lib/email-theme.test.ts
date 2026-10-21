import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brand } from '../supabase/functions/_shared/brand';
import { renderShell } from '../supabase/functions/_shared/email-shell';
import { colors } from './theme';

/**
 * The emails cannot import lib/theme (the edge functions run under Deno, the
 * auth templates are plain HTML Supabase serves), so they carry copies of
 * the palette. These tests keep the copies on Linen & Jade.
 */

// Every Organic-palette value the emails used before Linen & Jade.
const OLD_PALETTE = [
  '#f5ead8', '#ebddc5', '#201e1d', '#807a71', '#d67f48', '#8c491a', '#dcd3c4',
  '#fffaf1', '#676158', '#a19786', '#c0b6a5',
];

describe('notification email brand mirrors lib/theme', () => {
  it('uses the Linen & Jade values', () => {
    expect(brand).toMatchObject({
      bg: colors.bg,
      surface: colors.surface,
      text: colors.text,
      muted: colors.textMuted,
      button: colors.accent[700],
      accentDark: colors.accent[700],
      divider: colors.neutral[300],
    });
  });
});

// WCAG 2.1 contrast, same formula as lib/theme.test.ts.
function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('notification email call to action', () => {
  // Matches the app's primary Button (accent[700]): white on accentColor
  // is about 2.9:1, under AA for the 16px label.
  it('fills the button with accent[700], which carries white text at AA', () => {
    const html = renderShell(
      {
        subject: 's',
        headline: 'h',
        paragraphs: [],
        cta: { label: 'Open', url: 'https://example.test' },
        footerNote: 'n',
      },
      'Club',
      'https://example.test/settings',
    );
    expect(html).toContain(`background:${colors.accent[700]};`);
    expect(html).not.toContain(colors.accent[500]);
    expect(contrast('#ffffff', brand.button)).toBeGreaterThanOrEqual(4.5);
  });
});

describe.each(['magic_link.html', 'confirmation.html'])('auth email %s', (file) => {
  const html = readFileSync(join(__dirname, '..', 'supabase', 'templates', file), 'utf8');

  it('loads DM Serif Display for the headline, with a Georgia, serif fallback', () => {
    expect(html).toContain('family=DM+Serif+Display');
    expect(html).toMatch(/\.headline \{ font-family: 'DM Serif Display', Georgia, serif; \}/);
  });

  // Footer lines and the code label are real 12-13px text, so they need
  // AA's 4.5:1 on the email background, not the old faint neutrals.
  it('draws every text colour at 4.5:1 or better on the email background', () => {
    const textColours = [...html.matchAll(/[^-]color:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]);
    expect(textColours.length).toBeGreaterThan(0);
    for (const hex of textColours) {
      expect(contrast(hex, colors.bg), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('has no Caprasimo left', () => {
    expect(html.toLowerCase()).not.toContain('caprasimo');
  });

  it('has no Organic-palette colours left', () => {
    for (const hex of OLD_PALETTE) expect(html.toLowerCase()).not.toContain(hex);
  });
});
