/**
 * The only duplication in this plan, and named so it is not later mistaken
 * for an oversight.
 *
 * These values are copied from `lib/theme.ts` — `colors.bg`,
 * `colors.surface`, `colors.text`, `colors.textMuted`, `accent[500]`,
 * `accent[700]` and `neutral[300]`. This function runs under Deno and
 * cannot resolve through Metro, so importing the real module is not
 * available. If the palette moves in lib/theme, move it here too --
 * lib/email-theme.test.ts fails until it does. (Linen & Jade, 2026-10-21.)
 */
export const brand = {
  name: 'MahjHero',
  bg: '#faf5ee',
  surface: '#f1e8dc',
  text: '#2a2321',
  muted: '#706862',
  accent: '#df7a55',
  accentDark: '#9e4626',
  divider: '#e5dbd0',
} as const;
