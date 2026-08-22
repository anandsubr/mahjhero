import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import Button from '../../components/Button';
import ErrorBanner from '../../components/ErrorBanner';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import { ChevronLeftIcon } from '../../components/icons';
import { createClub } from '../../lib/clubs';
import { useSession } from '../../lib/session';
import { colors, space, type } from '../../lib/theme';

export default function NewClubScreen() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [rhythm, setRhythm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  async function onCreate() {
    if (!session || saving) return;
    setError(null);
    setSaving(true);
    const { clubId, error: createError } = await createClub(name, rhythm);
    setSaving(false);
    if (createError || !clubId) {
      setError(createError ?? 'Could not create the club.');
      return;
    }
    router.replace(`/clubs/${clubId}`);
  }

  return (
    <Screen scroll contentStyle={styles.container}>
      <Button
        variant="ghost"
        big={false}
        onPress={() => router.push('/clubs')}
        icon={<ChevronLeftIcon color={colors.accentColor} />}
        accessibilityLabel="Back to your clubs"
        style={styles.backButton}
      >
        Clubs
      </Button>

      <Text style={styles.heading}>Start a club</Text>
      <Text style={styles.help}>
        A club is just a name and a rhythm. Invite people once it exists.
      </Text>

      <TextField
        label="Club name"
        value={name}
        onChangeText={(value) => {
          setName(value);
          setError(null);
        }}
        placeholder="Oakfield Tiles"
        accessibilityLabel="Club name"
      />

      <TextField
        label="When you usually play"
        value={rhythm}
        onChangeText={setRhythm}
        placeholder="Thursday evenings"
        accessibilityLabel="When you usually play"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <Button
        onPress={onCreate}
        disabled={saving || name.trim().length === 0}
        accessibilityLabel="Create the club"
      >
        {saving ? 'Creating…' : 'Create the club'}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space[6],
    gap: space[4],
  },
  centered: {
    alignItems: 'center',
  },
  backButton: {
    alignSelf: 'flex-start',
  },
  heading: {
    fontFamily: type.heading,
    fontSize: type.size.h2,
    color: colors.text,
  },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
});
