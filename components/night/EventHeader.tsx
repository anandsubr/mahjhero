import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import CompactHeader from '../CompactHeader';
import { colors, type } from '../../lib/theme';

/**
 * The event page's header. People reach /e/<token> from a text or an email,
 * so there is no reliable history behind it:
 *
 * - Signed in: the usual back chevron, always to Home (not `back()`, which
 *   could land on the sign-in screen or an edit form).
 * - Signed out: the app icon and wordmark, which say what this is and lead
 *   to Welcome, and a Sign in link that comes back here afterwards.
 */
export default function EventHeader({
  signedIn,
  onHome,
  onWelcome,
  onSignIn,
}: {
  signedIn: boolean;
  onHome: () => void;
  onWelcome: () => void;
  onSignIn: () => void;
}) {
  if (signedIn) {
    return (
      <CompactHeader
        divider={false}
        onBack={onHome}
        backLabel="Back to Home"
        kind={null}
        titleOnly
        title="Mahj Night"
      />
    );
  }
  return (
    <View style={styles.row} testID="event-header-signed-out">
      <Pressable
        onPress={onWelcome}
        accessibilityRole="link"
        accessibilityLabel="About MahjHero"
        style={({ pressed }) => [styles.brand, pressed && styles.pressed]}
      >
        <Image source={require('../../assets/icon.png')} style={styles.icon} />
        <Text style={styles.wordmark}>MahjHero</Text>
      </Pressable>
      <Pressable
        onPress={onSignIn}
        accessibilityRole="button"
        accessibilityLabel="Sign in"
        style={({ pressed }) => [styles.signIn, pressed && styles.pressed]}
      >
        <Text style={styles.signInText}>Sign in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  icon: { width: 32, height: 32, borderRadius: 9 },
  wordmark: { fontFamily: type.heading, fontSize: 22, color: colors.text },
  signIn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInText: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  pressed: { opacity: 0.8 },
});
