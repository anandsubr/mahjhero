import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, shadow, space, type } from '../lib/theme';

export type MahjongSuit =
  | 'dots'
  | 'bamboo'
  | 'red-dragon'
  | 'green-dragon'
  | 'east-wind'
  | 'south-wind'
  | 'west-wind'
  | 'north-wind';

type Props = {
  suit: MahjongSuit;
  /** `"tab"`: the bottom tab bar's own tile (70x77), carries `label` (the
   *  tab's full word). `"section"`: the small tile before a landing
   *  screen's own heading (30x40) -- no label, ever, even if one is
   *  passed. `"chip"`: a club's own tile (48x60, `ClubChips.tsx` and the
   *  large club-header treatment) -- carries `label` too, but as the
   *  club's initials, not a full word. */
  size: 'tab' | 'section' | 'chip';
  /** `TileHero`'s (app/welcome.tsx) accent-tile treatment: solid
   *  `accentColor` fill, `accent[700]` lip, glyph/label in `colors.bg`.
   *  Meaningful for `size="tab"` and `size="chip"` -- never `"section"`,
   *  which is always the plain, decorative surface-fill tile. */
  selected?: boolean;
  /** Rendered for `size="tab"` and `size="chip"`; never for `"section"`. */
  label?: string;
};

// Authentic mahjong ink colors -- dots/bamboo stroke colors match
// TileHero's own two suit tiles exactly; red/green dragon match the real
// ink each of those two honor tiles is traditionally printed in. Not
// chosen for any semantic link to Profile/Alerts.
const GLYPH_COLOR: Record<MahjongSuit, string> = {
  dots: colors.accentColor,
  bamboo: colors.accent2[600],
  'red-dragon': colors.accentColor,
  'green-dragon': colors.accent2[700],
  // Real mahjong sets print the wind tiles in plain black ink, not the
  // suit/dragon colors -- colors.text is this palette's nearest match,
  // same reasoning every other glyph's color already follows here.
  'east-wind': colors.text,
  'south-wind': colors.text,
  'west-wind': colors.text,
  'north-wind': colors.text,
};

const GLYPH_HEIGHT = 24;

const CHARACTER_GLYPHS: Partial<Record<MahjongSuit, string>> = {
  'red-dragon': '中',
  'green-dragon': '發',
  'east-wind': '東',
  'south-wind': '南',
  'west-wind': '西',
  'north-wind': '北',
};

function Glyph({ suit, color }: { suit: MahjongSuit; color: string }) {
  // `testID={`glyph-${suit}`}` on every branch, not only dots/bamboo's SVGs:
  // a suit-parity test (app/__tests__/nav-glyph-parity.test.tsx) needs one
  // uniform, suit-distinguishing selector across all suits -- dots and
  // bamboo render an SVG with no text to key off of, so this is that
  // signal's single source, reused by every character glyph too rather
  // than mixing a testID lookup for some suits with a getByText lookup for
  // the rest.
  const character = CHARACTER_GLYPHS[suit];
  if (character) {
    return (
      <Text testID={`glyph-${suit}`} style={[styles.character, { color }]}>
        {character}
      </Text>
    );
  }
  // Both suit glyphs share TileHero's own viewBox and stroke shape --
  // copied from app/welcome.tsx's TileHero verbatim, only width/height/
  // stroke-width/color are this component's own.
  const width = Math.round(GLYPH_HEIGHT * 0.67);
  if (suit === 'dots') {
    return (
      <Svg testID={`glyph-${suit}`} width={width} height={GLYPH_HEIGHT} viewBox="0 0 26 40" fill="none" stroke={color} strokeWidth={3}>
        <Circle cx={13} cy={8} r={4.5} />
        <Circle cx={13} cy={20} r={4.5} />
        <Circle cx={13} cy={32} r={4.5} />
      </Svg>
    );
  }
  return (
    <Svg testID={`glyph-${suit}`} width={width} height={GLYPH_HEIGHT} viewBox="0 0 26 40" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round">
      <Path d="M7 6v28M13 6v28M19 6v28" />
      <Path d="M4 14h6M10 14h6M16 14h6M4 26h6M10 26h6M16 26h6" />
    </Svg>
  );
}

/**
 * A mahjong tile: the same chrome `TileHero` (app/welcome.tsx) draws for
 * its three decorative hero tiles -- `colors.surface` fill, a raised ivory
 * lip via `borderBottomWidth`/`borderBottomColor`, `shadow.sm` -- carrying
 * one real suit or honor glyph, and (size `"tab"` only) a label at the
 * tile's bottom edge. Used by the bottom tab bar (components/TabBar.tsx,
 * size `"tab"`, one per tab) and by each of the four landing screens' own
 * headings (size `"section"`, purely decorative, no label).
 *
 * Unlike `TileHero`'s three tiles, this one is always upright -- rotation
 * is that hero's own decorative-only treatment, not this shared tile's.
 *
 * Consumers: the bottom tab bar (components/TabBar.tsx, size `"tab"`, one
 * per tab, `selected` on the active one); the clubs dashboard's chip row
 * (components/ClubChips.tsx, size `"chip"`, `selected` on the chosen club);
 * a club thread's own avatar (components/ThreadAvatar.tsx's `asTile`
 * branch, size `"chip"`); and each of the four landing screens' own
 * headings (size `"section"`, purely decorative, no label, never
 * `selected`).
 */
export default function MahjongTile({ suit, size, selected = false, label }: Props) {
  const glyphColor = selected ? colors.bg : GLYPH_COLOR[suit];
  const labelColor = selected ? colors.bg : colors.neutral[800];
  const showsLabel = size === 'tab' || size === 'chip';

  const sizeStyle =
    size === 'tab' ? styles.tab : size === 'chip' ? styles.chip : styles.section;

  return (
    <View
      style={[styles.tile, sizeStyle, selected ? styles.selected : null]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
    >
      <Glyph suit={suit} color={glyphColor} />
      {showsLabel && label ? (
        <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 4,
    borderBottomColor: colors.neutral[200],
    ...shadow.sm,
    alignItems: 'center',
  },
  tab: {
    width: 70,
    height: 77,
    justifyContent: 'flex-end',
    paddingBottom: space[2],
    gap: 3,
  },
  section: {
    width: 30,
    height: 40,
    borderBottomWidth: 3,
    justifyContent: 'center',
  },
  chip: {
    width: 48,
    height: 60,
    justifyContent: 'flex-end',
    paddingBottom: space[1],
    gap: 2,
    borderBottomWidth: 3,
  },
  // accent[700] fill / accent[800] lip -- one step darker each than
  // TileHero's own accent tile (app/welcome.tsx: accentColor fill,
  // accent[700] lip), which keeps the same raised-edge relationship. Not
  // TileHero's own accentColor: colors.bg text/glyph on accentColor measures
  // 3.03:1, well under AA's 4.5:1 -- a documented, already-fixed failure
  // (lib/theme.test.ts's "unread badge text clears AA on its background"),
  // and this tile's label is 12px, never large enough for the 3:1 allowance.
  // accent[700] clears it at 5.72:1 (see this file's own pin in
  // lib/theme.test.ts).
  selected: {
    backgroundColor: colors.accent[700],
    borderBottomColor: colors.accent[800],
  },
  character: {
    fontSize: 21,
    lineHeight: GLYPH_HEIGHT,
  },
  label: {
    fontFamily: type.heading,
    fontSize: 12,
    lineHeight: 14,
  },
});
