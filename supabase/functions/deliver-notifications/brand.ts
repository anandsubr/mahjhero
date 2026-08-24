/**
 * The only duplication in this plan, and named so it is not later mistaken
 * for an oversight.
 *
 * These values are copied from `lib/theme.ts` — `colors.bg`,
 * `colors.surface`, `colors.text`, `colors.textMuted`, `accent[500]`,
 * `accent[700]` and `neutral[300]`. This function runs under Deno and
 * cannot resolve through Metro, so importing the real module is not
 * available. If the palette moves in lib/theme, move it here too.
 */
export const brand = {
  name: 'MahjHero',
  bg: '#f5ead8',
  surface: '#ebddc5',
  text: '#201e1d',
  muted: '#807a71',
  accent: '#d67f48',
  accentDark: '#8c491a',
  divider: '#dcd3c4',
} as const;
