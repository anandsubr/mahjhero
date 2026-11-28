import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { formatNightWhen, type MyNight } from '../../lib/mahj-nights';
import { nightTheme } from '../../lib/themes';
import { colors, type } from '../../lib/theme';

/** One of Your Mahj Nights on Home: opens its event page. */
export default function NightCard({ night, onPress }: { night: MyNight; onPress: () => void }) {
  const theme = nightTheme(night.themeId);
  const when = formatNightWhen(night.startsAt, night.timezone);
  const sub = [night.cancelled ? 'Cancelled' : when, night.area].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${night.title}, ${sub}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.swatch, { backgroundColor: theme.bg }]}>
        <View style={[styles.tile, { backgroundColor: theme.tile, borderBottomColor: theme.tileEdge }]} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {night.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 12,
    minHeight: 64,
  },
  pressed: { opacity: 0.85 },
  swatch: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tile: { width: 16, height: 22, borderRadius: 4, borderBottomWidth: 3 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: type.bodyBold, fontSize: 16, color: colors.text },
  sub: { fontFamily: type.bodyRegular, fontSize: 13, color: colors.neutral[700] },
  chevron: { fontFamily: type.bodyBold, fontSize: 22, color: colors.accent[700] },
});
