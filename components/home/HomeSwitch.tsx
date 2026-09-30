import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { colors, radius, type } from '../../lib/theme';

export type HomeView = 'myGames' | 'clubs';

const OPTIONS: { key: HomeView; label: string }[] = [
  { key: 'myGames', label: 'My games' },
  { key: 'clubs', label: 'Clubs' },
];

/**
 * Home's segmented pill: My games (with its upcoming count) | Clubs.
 * `aria-selected` is passed alongside `accessibilityState` because
 * react-native-web only maps the latter to the DOM for some roles.
 */
export default function HomeSwitch({
  value,
  upcomingCount,
  onChange,
}: {
  value: HomeView;
  upcomingCount: number;
  onChange: (v: HomeView) => void;
}) {
  return (
    <View style={styles.track}>
      {OPTIONS.map((o) => {
        const selected = value === o.key;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            aria-selected={selected}
            accessibilityLabel={
              o.key === 'myGames' ? `My games, ${upcomingCount} upcoming` : 'Clubs'
            }
            onPress={() => onChange(o.key)}
            style={[styles.option, selected && styles.selected]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{o.label}</Text>
            {o.key === 'myGames' && upcomingCount > 0 ? (
              <Text style={[styles.count, selected && styles.selectedLabel]}>{upcomingCount}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 4,
  },
  option: {
    flex: 1,
    // 44pt hit target (the design's 42pt option plus the track padding
    // would read the same; the app-wide floor is 44).
    minHeight: 44,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  selected: { backgroundColor: colors.accent[700] },
  label: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  count: { fontFamily: type.bodyBold, fontSize: 13, color: colors.neutral[700] },
  selectedLabel: { color: '#fff' },
});
