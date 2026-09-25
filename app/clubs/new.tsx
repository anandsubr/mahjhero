import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import ErrorBanner from '../../components/ErrorBanner';
import {
  ActionBar,
  FormCard,
  FormHeader,
  FormTitle,
  TextRow,
  formStyles,
} from '../../components/GameForm';
import Screen from '../../components/Screen';
import TabBar from '../../components/TabBar';
import { createClub } from '../../lib/clubs';
import { useSession } from '../../lib/session';
import { colors, type } from '../../lib/theme';

/**
 * Start a club (profile & club handoff, 1b): a flow screen in the game
 * form's shape — ✕ + "Clubs" header, a live preview of the club's tile and
 * name, one card of fields, and "Create the club" pinned where the tab bar
 * would be.
 *
 * "Description (optional)" is the club's `rhythm` column under a new label —
 * the design binds it to the same state — so it keeps showing as the line
 * under the club's name in its header, one line with an ellipsis.
 *
 * The ✕ goes to `/clubs` rather than `back()`: TabBar navigates with
 * `replace` off an entry route that is itself a Redirect, so the history
 * stack here is typically one deep (2026-09-01-back-links-design.md).
 */
export default function NewClubScreen() {
  const { session, loading } = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [rhythm, setRhythm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading) {
    return (
      <Screen center contentStyle={styles.centered} tabBar={<TabBar active="club" />}>
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
    const { clubId, error: createError } = await createClub(name, rhythm);
    setSaving(false);
    if (createError || !clubId) {
      setError(createError ?? 'Could not create the club.');
      return;
    }
    router.replace(`/clubs/${clubId}`);
  }

  return (
    <Screen
      scroll
      contentStyle={formStyles.body}
      tabBar={
        <ActionBar
          primaryLabel="Create the club"
          primaryAccessibilityLabel="Create the club"
          onPrimary={onCreate}
          busy={saving}
          disabled={!canCreate}
        />
      }
    >
      <FormHeader
        clubName="Clubs"
        closeLabel="Back to your clubs"
        onClose={() => router.push('/clubs')}
      />

      <View style={styles.intro}>
        <FormTitle>Start a club</FormTitle>
        <Text style={styles.introText}>
          A club is just a name and a rhythm. Invite people once it exists.
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
            {trimmedName || 'Your club'}
          </Text>
          <Text numberOfLines={1} style={styles.previewRhythm}>
            {trimmedRhythm || 'Add a short description'}
          </Text>
        </View>
      </View>

      {error ? <ErrorBanner message={error} /> : null}

      <FormCard>
        <TextRow
          label="Club name"
          value={name}
          onChangeText={(value) => {
            setName(value);
            setError(null);
          }}
          placeholder="Oakfield Tiles"
          accessibilityLabel="Club name"
        />
        <TextRow
          label="Description (optional)"
          value={rhythm}
          onChangeText={setRhythm}
          placeholder="Who it's for, when you play, where you meet…"
          accessibilityLabel="Description"
          multiline
          numberOfLines={3}
          inputStyle={styles.description}
        />
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
  description: {
    fontFamily: type.bodyRegular,
    lineHeight: 22,
    minHeight: 66,
    // Web only: a textarea's drag handle. Not in RN's style types.
    ...({ resize: 'none' } as object),
  },
});
