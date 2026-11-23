import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import Button from '../components/Button';
import CompactHeader from '../components/CompactHeader';
import ErrorBanner from '../components/ErrorBanner';
import { ConfirmSheet } from '../components/GameForm';
import Screen from '../components/Screen';
import { deleteAccount } from '../lib/account';
import { goBack } from '../lib/navigation';
import { useSession } from '../lib/session';
import { colors, space, type } from '../lib/theme';

const DELETED_ITEMS = [
  'Your profile and sign-in',
  'Your messages, board posts and the replies under them',
  'Photos and files you shared',
  'Your bookings. Seats you hold are released to the waitlist',
  "Clubs you host pass to the longest-standing member, or close if you're the only one",
];

export default function DeleteAccountScreen() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const header = (
    <CompactHeader
      divider={false}
      onBack={() => goBack(router, '/profile')}
      backLabel="Back to Profile"
      kind={null}
      titleOnly
      title="Delete account"
    />
  );

  if (!loading && !session && !deleting) return <Redirect href="/" />;

  async function onConfirm() {
    setConfirming(false);
    if (deleting) return;
    setError(null);
    setDeleting(true);
    const { error: deleteError } = await deleteAccount();
    if (deleteError) {
      setDeleting(false);
      setError(deleteError);
      return;
    }
    router.replace('/welcome?deleted=1');
  }

  return (
    <Screen header={header} scroll contentStyle={styles.container}>
      <Text style={styles.title}>Delete your account</Text>
      <Text style={styles.body}>Deleting your account permanently removes:</Text>
      <View style={styles.list}>
        {DELETED_ITEMS.map((item) => (
          <Text key={item} style={styles.item}>
            {'•  '}
            {item}
          </Text>
        ))}
      </View>
      <Text style={styles.warning}>This can&apos;t be undone.</Text>
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        variant="destructive"
        block
        loading={deleting}
        disabled={deleting}
        onPress={() => setConfirming(true)}
        accessibilityLabel="Delete my account"
      >
        Delete my account
      </Button>
      {confirming ? (
        <ConfirmSheet
          title="Delete your account?"
          body="This can't be undone."
          confirmLabel="Delete my account"
          cancelLabel="Cancel"
          onConfirm={onConfirm}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  title: { fontFamily: type.heading, fontSize: 24, color: colors.text },
  body: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.text },
  list: { gap: space[2] },
  item: { fontFamily: type.bodyRegular, fontSize: 16, lineHeight: 22, color: colors.text },
  warning: { fontFamily: type.bodyBold, fontSize: 16, color: colors.accent[800] },
});
