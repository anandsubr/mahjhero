import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brand } from '../supabase/functions/_shared/brand';
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
      accent: colors.accent[500],
      accentDark: colors.accent[700],
      divider: colors.neutral[300],
    });
  });
});

describe.each(['magic_link.html', 'confirmation.html'])('auth email %s', (file) => {
  const html = readFileSync(join(__dirname, '..', 'supabase', 'templates', file), 'utf8');

  it('loads DM Serif Display for the headline, with a Georgia, serif fallback', () => {
    expect(html).toContain('family=DM+Serif+Display');
    expect(html).toMatch(/\.headline \{ font-family: 'DM Serif Display', Georgia, serif; \}/);
  });

  it('has no Caprasimo left', () => {
    expect(html.toLowerCase()).not.toContain('caprasimo');
  });

  it('has no Organic-palette colours left', () => {
    for (const hex of OLD_PALETTE) expect(html.toLowerCase()).not.toContain(hex);
  });
});
