import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet } from 'react-native';
import Screen from '../components/Screen';
import { useSession } from '../lib/session';
import { colors } from '../lib/theme';

export default function Index() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  return <Redirect href={session ? '/clubs' : '/sign-in'} />;
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
  },
});
