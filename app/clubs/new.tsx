import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../../components/Text';
import ErrorBanner from '../../components/ErrorBanner';
import ClubCodeField from '../../components/home/ClubCodeField';
import {
  ActionBar,
  FormCard,
  FormHeader,
  FormTitle,
  TextRow,
  formStyles,
} from '../../components/GameForm';
import Screen from '../../components/Screen';
import { createClub } from '../../lib/clubs';
import { useSession } from '../../lib/session';
import { colors, type } from '../../lib/theme';

/**
 * Start a group (profile & club handoff, 1b): a flow screen in the game
 * form's shape — ✕ + "Groups" header, a live preview of the group's tile and
 * name, one card of fields, and "Create the group" pinned at the bottom.
 *
 * "When do you usually play?" is the club's `rhythm` column under a new
 * label, so it keeps showing as the line under the group's name in its
 * header, one line with an ellipsis.
 *
 * `?for=night` is Host a Mahj Night's stand-in until the Mahj Night create
 * flow exists (pivot batch 2): the same form, worded for a one-off night,
 * then straight on to that group's New game form.
 *
 * The ✕ goes to `/home` rather than `back()`, since the history stack here
 * is typically one deep (2026-09-01-back-links-design.md).
 */
export default function NewClubScreen() {
  const { session, loading } = useSession();
  const router = useRouter();
  const { for: purpose } = useLocalSearchParams<{ for?: string }>();
  const forNight = purpose === 'night';
  const [name, setName] = useState('');
  const [rhythm, setRhythm] = useState('');
  const [code, setCode] = useState('');
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

  const trimmedName = name.trim();
  const trimmedRhythm = rhythm.trim();
  const canCreate = trimmedName.length > 0;

  async function onCreate() {
    if (!session || saving || !canCreate) return;
    setError(null);
    setSaving(true);
    const { clubId, error: createError } = await createClub(name, rhythm, code);
    setSaving(false);
    if (createError || !clubId) {
      setError(createError ?? 'Could not create the group.');
      return;
    }
    router.replace(forNight ? `/clubs/${clubId}/events/new` : `/clubs/${clubId}/games`);
  }

  return (
    <Screen
      scroll
      contentStyle={formStyles.body}
      footer={
        <ActionBar
          primaryLabel={forNight ? 'Next: the night' : 'Create the group'}
          primaryAccessibilityLabel={forNight ? 'Next: the night' : 'Create the group'}
          onPrimary={onCreate}
          busy={saving}
          disabled={!canCreate}
        />
      }
    >
      <FormHeader
        clubName="Groups"
        closeLabel="Back to Home"
        onClose={() => router.push('/home')}
      />

      <View style={styles.intro}>
        <FormTitle>{forNight ? 'Host a Mahj Night' : 'Start a group'}</FormTitle>
        <Text style={styles.introText}>
          {forNight
            ? 'Who is it for? Name the night, then pick the date and tables. If everyone wants to keep playing, it can become your group.'
            : 'A group is just a name and when you play. Invite people once it exists.'}
        </Text>
      </View>

      <View style={styles.preview} testID="club-preview">
        <View style={styles.previewTile}>
          <Text style={styles.previewInitial}>
            {(trimmedName[0] ?? '?').toUpperCase()}
          </Text>
        </View>
        <View style={styles.previewText}>
          <Text
            numberOfLines={1}
            style={[styles.previewName, !canCreate && styles.previewPlaceholder]}
          >
            {trimmedName || (forNight ? 'Your Mahj Night' : 'Your group')}
          </Text>
          <Text numberOfLines={1} style={styles.previewRhythm}>
            {trimmedRhythm || (forNight ? 'A one-off night' : 'When you usually play')}
          </Text>
        </View>
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <FormCard>
        <TextRow
          label={forNight ? 'Name the night' : 'Group name'}
          value={name}
          onChangeText={(value) => {
            setName(value);
            setError(null);
          }}
          placeholder={forNight ? "Ellie's holiday Mahj Night" : 'Thursday Tiles'}
          accessibilityLabel={forNight ? 'Name the night' : 'Group name'}
        />
        {forNight ? null : (
          <>
            <TextRow
              label="When do you usually play? (optional)"
              value={rhythm}
              onChangeText={setRhythm}
              placeholder="Thursday evenings"
              accessibilityLabel="When do you usually play?"
            />
            <ClubCodeField
              label="Group code (optional)"
              value={code}
              onChangeText={setCode}
              helper="People type this on Home to join. Leave blank and we'll make one. You can change it later."
            />
          </>
        )}
      </FormCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
  },
  intro: { gap: 8 },
  introText: {
    fontFamily: type.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.neutral[700],
    paddingHorizontal: 4,
  },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 4,
  },
  previewTile: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewInitial: { fontFamily: type.heading, fontSize: 24, color: colors.accent[700] },
  previewText: { flex: 1, minWidth: 0 },
  previewName: { fontFamily: type.bodyBold, fontSize: 17, lineHeight: 21, color: colors.text },
  previewPlaceholder: { color: colors.neutral[600] },
  previewRhythm: {
    fontFamily: type.bodyRegular,
    fontSize: 13,
    lineHeight: 16,
    color: colors.neutral[700],
  },
});
