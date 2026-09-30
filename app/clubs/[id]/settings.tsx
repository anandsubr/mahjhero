import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../../components/Text';
import Button from '../../../components/Button';
import CompactHeader from '../../../components/CompactHeader';
import ErrorBanner from '../../../components/ErrorBanner';
import ClubCodeField from '../../../components/home/ClubCodeField';
import ClubCover from '../../../components/hub/ClubCover';
import Screen from '../../../components/Screen';
import Toggle from '../../../components/Toggle';
import { pickImages } from '../../../lib/attachments';
import {
  getClubCoverUrl,
  removeClubCover,
  setClubCoverColor,
  uploadClubCover,
} from '../../../lib/club-cover';
import { COVER_COLORS, type CoverColor } from '../../../lib/club-hub';
import {
  canInvite,
  fetchClub,
  fetchMyRoles,
  setClubCode,
  setDefaultGameMode,
  type Club,
  type ClubRole,
} from '../../../lib/clubs';
import { useSession } from '../../../lib/session';
import { colors, radius, space, type } from '../../../lib/theme';

type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; club: Club; role: ClubRole | null; coverUrl: string | null };

/**
 * Club settings (organizers only): the cover photo and colour, the club
 * code, the invite-only default for new games, and links to Venues and
 * Import a roster. Reached from the hub header's gear; everyone else is
 * sent to the hub's Games section.
 *
 * The hub layout (app/clubs/[id]/(hub)/_layout.tsx) reloads its club when
 * it regains focus, so a cover or code changed here shows in its header
 * as soon as the organizer goes back.
 */
export default function ClubSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const [state, setState] = useState<State>({ status: 'loading' });
  const loadSeq = useRef(0);

  const [coverBusy, setCoverBusy] = useState<'upload' | 'remove' | 'color' | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSaving, setCodeSaving] = useState(false);
  // Written synchronously and cleared on every exit path, the same shape
  // app/clubs/index.tsx uses for runBookingAction: `busy` state alone is
  // read from the render closure, so a guard written as `if (busy) return`
  // is blind to a second tap landing before React has re-rendered with the
  // disabled button -- this repo has shipped that exact bug five times.
  const gameModeBusyRef = useRef(false);
  const coverBusyRef = useRef(false);

  /**
   * `background` is a reload after a change: a failure there keeps the
   * screen as it is rather than replacing it with the error state.
   */
  const fetchAll = useCallback(
    async (background: boolean): Promise<void> => {
      if (!id || !userId) return;
      const seq = ++loadSeq.current;
      const [club, roles] = await Promise.all([fetchClub(id), fetchMyRoles(userId)]);
      if (seq !== loadSeq.current) return;
      if (!club || !roles) {
        if (!background) setState({ status: 'failed' });
        return;
      }
      const coverUrl = club.cover_path ? await getClubCoverUrl(club.cover_path) : null;
      if (seq !== loadSeq.current) return;
      const role = roles.find((r) => r.club_id === id)?.role ?? null;
      setState({ status: 'ready', club, role, coverUrl });
    },
    [id, userId],
  );

  useEffect(() => {
    setState({ status: 'loading' });
    void fetchAll(false);
    return () => {
      loadSeq.current += 1;
    };
  }, [fetchAll]);

  function goBack() {
    // Settings is pushed from the hub, so popping returns to the same hub
    // (which reloads on focus). A cold open has nothing to pop.
    if (router.canGoBack()) router.back();
    else router.replace(`/clubs/${id}/games`);
  }

  if (!loading && !session) return <Redirect href="/sign-in" />;

  if (state.status === 'failed') {
    return (
      <Screen scroll contentStyle={styles.container}>
        <CompactHeader
          variant="inset"
          onBack={goBack}
          backLabel="Back to the club"
          kind={null}
          title="Club settings"
        />
        <Text style={styles.body}>Could not load this club.</Text>
        <Button
          variant="secondary"
          big={false}
          accessibilityLabel="Retry"
          onPress={() => {
            setState({ status: 'loading' });
            void fetchAll(false);
          }}
        >
          Retry
        </Button>
      </Screen>
    );
  }

  if (loading || state.status === 'loading') {
    return (
      <Screen center contentStyle={styles.centered}>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }

  const { club, role, coverUrl } = state;
  if (!role || !canInvite(role)) return <Redirect href={`/clubs/${id}/games`} />;

  const setClub = (next: Club) => setState({ ...state, club: next });

  async function runCover(
    kind: 'upload' | 'remove' | 'color',
    action: () => Promise<{ error: string | null } | null>,
  ) {
    if (coverBusyRef.current) return;
    coverBusyRef.current = true;
    setCoverBusy(kind);
    setCoverError(null);
    try {
      const result = await action();
      // `null`: nothing to do (the picker was cancelled).
      if (!result) return;
      if (result.error) {
        setCoverError(result.error);
        return;
      }
      await fetchAll(true);
    } finally {
      coverBusyRef.current = false;
      setCoverBusy(null);
    }
  }

  function onUpload() {
    void runCover('upload', async () => {
      const picked = await pickImages('library', 0);
      const image = picked?.[0];
      if (!image) return null;
      return uploadClubCover(club.id, image);
    });
  }

  function onRemove() {
    void runCover('remove', () => removeClubCover(club.id));
  }

  function onPickColor(color: CoverColor) {
    if (color === club.cover_color) return;
    void runCover('color', () => setClubCoverColor(club.id, color));
  }

  async function onToggleDefaultGameMode(nextInviteOnly: boolean) {
    if (gameModeBusyRef.current) return;
    gameModeBusyRef.current = true;
    try {
      if (!club) return;
      setError(null);
      const nextMode = nextInviteOnly ? 'invite_only' : 'open_play';
      const { error: toggleError } = await setDefaultGameMode(club.id, nextMode);
      if (toggleError) {
        setError(toggleError);
        return;
      }
      setClub({ ...club, default_game_mode: nextMode });
    } finally {
      gameModeBusyRef.current = false;
    }
  }

  const hasPhoto = club.cover_path !== null;
  const busy = coverBusy !== null;

  return (
    <Screen scroll contentStyle={styles.container}>
      <CompactHeader
        variant="inset"
        onBack={goBack}
        backLabel="Back to the club"
        kind="club"
        clubId={club.id}
        avatarTestID="thread-avatar-club-tile"
        title="Club settings"
        subtitle={club.name}
      />

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">
          Cover
        </Text>
        <ClubCover
          coverUrl={coverUrl}
          coverColor={club.cover_color}
          style={styles.preview}
          testID="settings-cover-color"
          testIDPrefix="settings"
        />
        <View style={styles.coverButtons}>
          <Button
            variant="secondary"
            big={false}
            onPress={onUpload}
            disabled={busy}
            accessibilityLabel={hasPhoto ? 'Replace photo' : 'Upload photo'}
          >
            {hasPhoto ? 'Replace photo' : 'Upload photo'}
          </Button>
          {hasPhoto ? (
            <Button
              variant="ghost"
              big={false}
              onPress={onRemove}
              disabled={busy}
              accessibilityLabel="Remove photo"
            >
              Remove photo
            </Button>
          ) : null}
        </View>
        {coverBusy === 'upload' ? <Text style={styles.help}>Uploading…</Text> : null}
        <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel="Cover colour">
          {COVER_COLORS.map((c) => {
            const selected = club.cover_color === c.key;
            return (
              <Pressable
                key={c.key}
                onPress={() => onPickColor(c.key)}
                disabled={busy}
                accessibilityRole="radio"
                accessibilityLabel={c.label}
                aria-checked={selected}
                style={[styles.swatchTarget, selected && styles.swatchSelected]}
              >
                <View style={[styles.swatch, { backgroundColor: c.value }]} />
              </Pressable>
            );
          })}
        </View>
        {coverError ? <ErrorBanner message={coverError} /> : null}
      </View>

      <View style={styles.section}>
        <View style={styles.codeRow}>
          <Text style={styles.codeText}>{`Club code: ${club.code}`}</Text>
          {codeDraft === null ? (
            <Button
              variant="ghost"
              big={false}
              onPress={() => {
                setCodeDraft(club.code);
                setCodeError(null);
              }}
              accessibilityLabel="Change club code"
            >
              Change
            </Button>
          ) : null}
        </View>
        {codeDraft !== null ? (
          <View style={styles.codeEdit}>
            <ClubCodeField
              label="New club code"
              value={codeDraft}
              onChangeText={setCodeDraft}
              error={codeError}
            />
            <Button
              disabled={codeSaving}
              onPress={async () => {
                setCodeSaving(true);
                const { code, error: saveError } = await setClubCode(club.id, codeDraft);
                setCodeSaving(false);
                if (saveError || !code) {
                  setCodeError(saveError);
                  return;
                }
                setClub({ ...club, code });
                setCodeDraft(null);
              }}
              accessibilityLabel="Save code"
            >
              Save code
            </Button>
            <Button
              variant="ghost"
              big={false}
              onPress={() => setCodeDraft(null)}
              accessibilityLabel="Cancel"
            >
              Cancel
            </Button>
          </View>
        ) : null}
      </View>

      <View style={styles.gameModeRow}>
        <Text style={styles.help}>New games default to invite-only</Text>
        <Toggle
          value={club.default_game_mode === 'invite_only'}
          onValueChange={onToggleDefaultGameMode}
          accessibilityLabel="New games default to invite-only"
        />
      </View>

      <Button
        variant="secondary"
        onPress={() => router.push(`/clubs/${id}/venues`)}
        accessibilityLabel="Venues"
      >
        Venues
      </Button>
      <Button
        variant="secondary"
        onPress={() => router.push(`/clubs/${id}/import`)}
        accessibilityLabel="Import a roster from a spreadsheet"
      >
        Import a roster
      </Button>

      {error ? <ErrorBanner message={error} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: space[6], gap: space[4] },
  centered: { alignItems: 'center' },
  section: { gap: space[3] },
  sectionTitle: { fontFamily: type.bodyBold, fontSize: type.size.body, color: colors.text },
  body: { fontFamily: type.bodyRegular, fontSize: type.size.body, color: colors.text },
  help: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textMuted,
    lineHeight: 24,
  },
  preview: { width: '100%', height: 120, borderRadius: radius.md, overflow: 'hidden' },
  coverButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  // A 44pt round target with the colour drawn inside it; the selected one
  // gets a 2px accent ring around the colour.
  swatchTarget: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchSelected: { borderColor: colors.accentColor },
  swatch: { width: 34, height: 34, borderRadius: radius.pill },
  gameModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  codeText: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.text },
  codeEdit: { gap: 8 },
});
