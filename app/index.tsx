import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

export default function Index() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </View>
    );
  }

  return <Redirect href={session ? '/profile' : '/sign-in'} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
