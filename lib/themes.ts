import { colors } from './theme';

/**
 * Mahj Night themes (pivot batch 2). Two free ones to start, drawn from the
 * brand palette; Batch 4 replaces the artwork and adds the shop.
 *
 * `clubs.theme_id` stores the id. The artwork is drawn from these values by
 * components/night/ThemeArt.tsx in the app and by api/og/[token].tsx for the
 * link preview, so the two always match.
 */
export type NightTheme = {
  id: string;
  name: string;
  /** Background of the artwork. */
  bg: string;
  /** Text on the background. */
  ink: string;
  /** Tile face and edge. */
  tile: string;
  tileEdge: string;
  /** The mark on each tile. */
  mark: string;
  motif: 'dots' | 'bamboo';
};

export const NIGHT_THEMES: readonly NightTheme[] = [
  {
    id: 'jade',
    name: 'Jade Garden',
    bg: colors.accent2[800],
    ink: colors.neutral[100],
    tile: colors.neutral[100],
    tileEdge: colors.accent2[400],
    mark: colors.accent2[600],
    motif: 'bamboo',
  },
  {
    id: 'peony',
    name: 'Peony',
    bg: colors.accent[700],
    ink: colors.neutral[100],
    tile: colors.neutral[100],
    tileEdge: colors.accent[300],
    mark: colors.accent[600],
    motif: 'dots',
  },
];

export const DEFAULT_THEME_ID = 'jade';

export function nightTheme(id: string | null | undefined): NightTheme {
  return NIGHT_THEMES.find((t) => t.id === id) ?? NIGHT_THEMES[0];
}
