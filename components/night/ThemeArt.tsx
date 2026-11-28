import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import type { NightTheme } from '../../lib/themes';

/**
 * A Mahj Night theme's artwork: a row of tiles on the theme's colour. Drawn
 * from plain views so it costs no image assets; api/og/[token].tsx draws
 * the same picture for the link preview. Batch 4 swaps in real artwork.
 */
export default function ThemeArt({
  theme,
  height = 140,
  style,
  children,
}: {
  theme: NightTheme;
  height?: number;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}) {
  const tile = Math.round(height * 0.34);
  return (
    <View
      style={[styles.wrap, { backgroundColor: theme.bg, height }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`theme-art-${theme.id}`}
    >
      <View style={[styles.tiles, { gap: tile * 0.18 }]}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.tile,
              {
                width: tile * 0.74,
                height: tile,
                backgroundColor: theme.tile,
                borderBottomColor: theme.tileEdge,
                borderBottomWidth: tile * 0.1,
                transform: [{ rotate: `${(i - 1.5) * 6}deg` }, { translateY: Math.abs(i - 1.5) * tile * 0.08 }],
              },
            ]}
          >
            {theme.motif === 'bamboo' ? (
              <View style={styles.bamboo}>
                {[0, 1].map((b) => (
                  <View
                    key={b}
                    style={{ width: tile * 0.1, height: tile * 0.56, borderRadius: tile, backgroundColor: theme.mark }}
                  />
                ))}
              </View>
            ) : (
              <View
                style={{
                  width: tile * 0.34,
                  height: tile * 0.34,
                  borderRadius: tile,
                  borderWidth: tile * 0.07,
                  borderColor: theme.mark,
                }}
              />
            )}
          </View>
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', alignItems: 'center' },
  tile: { borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  bamboo: { flexDirection: 'row', gap: 6 },
});
