import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { BellIcon } from '../icons';
import { colors, type } from '../../lib/theme';

/**
 * Home's header (Design V3 2a): app icon and wordmark on the left, the
 * Alerts bell (with an unread dot) and the Profile avatar on the right.
 */
export default function HomeHeader({
  initial,
  unread,
  onAlerts,
  onProfile,
}: {
  initial: string;
  unread: boolean;
  onAlerts: () => void;
  onProfile: () => void;
}) {
  return (
    <View style={styles.row}>
      <Image
        source={require('../../assets/icon.png')}
        style={styles.icon}
        accessibilityIgnoresInvertColors
      />
      <Text style={styles.wordmark} accessibilityRole="header">MahjHero</Text>
      <View style={styles.spacer} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unread ? 'Alerts, unread' : 'Alerts'}
        onPress={onAlerts}
        style={styles.alerts}
      >
        <BellIcon size={20} color={colors.text} />
        {unread ? <View style={styles.dot} /> : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Profile"
        onPress={onProfile}
        style={styles.avatar}
      >
        <Text style={styles.initial}>{initial}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 12 },
  icon: { width: 40, height: 40, borderRadius: 11 },
  wordmark: { fontFamily: type.heading, fontSize: 26, color: colors.text },
  spacer: { flex: 1 },
  alerts: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 10,
    right: 11,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.accent[600],
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent2[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { fontFamily: type.heading, fontSize: 20, color: '#fff' },
});
