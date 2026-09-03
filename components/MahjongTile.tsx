import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { colors, shadow, space, type } from '../lib/theme';

export type MahjongSuit = 'dots' | 'bamboo' | 'red-dragon' | 'green-dragon';

type Props = {
  suit: MahjongSuit;
  /** `"tab"`: the bottom tab bar's own tile (70x77), carries `label`.
   *  `"section"`: the small tile before a landing screen's own heading
   *  (30x40) -- no label, the real heading already says the words. */
  size: 'tab' | 'section';
  /** `TileHero`'s (app/welcome.tsx) accent-tile treatment: solid
   *  `accentColor` fill, `accent[700]` lip, glyph/label in `colors.bg`.
   *  Only meaningful for `size="tab"` -- the section tile is always the
   *  plain, decorative surface-fill tile. */
  selected?: boolean;
  /** Only rendered for `size="tab"`. */
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
};

const GLYPH_HEIGHT = 24;

function Glyph({ suit, color }: { suit: MahjongSuit; color: string }) {
  if (suit === 'red-dragon' || suit === 'green-dragon') {
    return (
      <Text style={[styles.character, { color }]}>
        {suit === 'red-dragon' ? '中' : '發'}
      </Text>
    );
  }
  // Both suit glyphs share TileHero's own viewBox and stroke shape --
  // copied from app/welcome.tsx's TileHero verbatim, only width/height/
  // stroke-width/color are this component's own.
  const width = Math.round(GLYPH_HEIGHT * 0.67);
  if (suit === 'dots') {
    return (
      <Svg width={width} height={GLYPH_HEIGHT} viewBox="0 0 26 40" fill="none" stroke={color} strokeWidth={3}>
        <Circle cx={13} cy={8} r={4.5} />
        <Circle cx={13} cy={20} r={4.5} />
        <Circle cx={13} cy={32} r={4.5} />
      </Svg>
    );
  }
  return (
    <Svg width={width} height={GLYPH_HEIGHT} viewBox="0 0 26 40" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round">
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
 */
export default function MahjongTile({ suit, size, selected = false, label }: Props) {
  const glyphColor = selected ? colors.bg : GLYPH_COLOR[suit];
  const labelColor = selected ? colors.bg : colors.neutral[800];

  return (
    <View
      style={[
        styles.tile,
        size === 'tab' ? styles.tab : styles.section,
        selected ? styles.selected : null,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden={true}
    >
      <Glyph suit={suit} color={glyphColor} />
      {size === 'tab' && label ? (
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
  selected: {
    backgroundColor: colors.accentColor,
    borderBottomColor: colors.accent[700],
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
