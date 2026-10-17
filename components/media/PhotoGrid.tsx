import { Image, Pressable, StyleSheet, View } from 'react-native';
import type { ClubMedia } from '../../lib/club-media';

type Props = {
  photos: ClubMedia[];
  /** storage_path -> signed URL; a missing path renders a placeholder. */
  urls: Record<string, string>;
  onOpen: (index: number) => void;
};

const COLUMNS = 3;
const GAP = 3;

/**
 * 3 columns of square cells, 3px gaps, rounded outer top corners. Laid out
 * as rows of three flex:1 cells (padded with spacers) so no container width
 * needs measuring.
 */
export default function PhotoGrid({ photos, urls, onOpen }: Props) {
  const rows: number[][] = [];
  for (let i = 0; i < photos.length; i += COLUMNS) {
    rows.push(Array.from({ length: Math.min(COLUMNS, photos.length - i) }, (_, k) => i + k));
  }
  return (
    <View style={styles.grid} testID="photo-grid">
      {rows.map((row, r) => (
        <View key={r} style={styles.row}>
          {Array.from({ length: COLUMNS }, (_, col) => {
            const index = row[col];
            if (index === undefined) return <View key={`s${col}`} style={styles.spacer} />;
            const p = photos[index];
            return (
              <Pressable
                key={p.id}
                onPress={() => onOpen(index)}
                accessibilityRole="button"
                accessibilityLabel={`Open photo ${index + 1} of ${photos.length}`}
                style={[
                  styles.cell,
                  r === 0 && col === 0 ? styles.topLeft : null,
                  r === 0 && col === COLUMNS - 1 ? styles.topRight : null,
                ]}
              >
                {urls[p.storagePath] ? (
                  <Image source={{ uri: urls[p.storagePath] }} style={styles.image} />
                ) : (
                  <View style={styles.placeholder} />
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: GAP },
  row: { flexDirection: 'row', gap: GAP },
  cell: { flex: 1, aspectRatio: 1, overflow: 'hidden' },
  spacer: { flex: 1 },
  topLeft: { borderTopLeftRadius: 14 },
  topRight: { borderTopRightRadius: 14 },
  image: { width: '100%', height: '100%' },
  placeholder: { width: '100%', height: '100%', backgroundColor: 'rgba(32, 30, 29, 0.08)' },
});
