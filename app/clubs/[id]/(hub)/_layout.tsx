import {
  Redirect,
  Slot,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
  useSegments,
} from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BackRow from '../../../../components/BackRow';
import Button from '../../../../components/Button';
import Screen from '../../../../components/Screen';
import { Text } from '../../../../components/Text';
import { ChevronLeftIcon } from '../../../../components/icons';
import ClubHubHeader from '../../../../components/hub/ClubHubHeader';
import { ClubHubContext, type ClubHubValue } from '../../../../components/hub/ClubHubContext';
import { getClubCoverUrl } from '../../../../lib/club-cover';
import { COVER_COLORS, HUB_SECTIONS, type HubSection } from '../../../../lib/club-hub';
import { canInvite, fetchClub, fetchMyRoles, type Club, type ClubRole } from '../../../../lib/clubs';
import { useSession } from '../../../../lib/session';
import { colors, type } from '../../../../lib/theme';

/**
 * The header's drawn height below the safe-area inset: 8 top padding, the
 * 44pt name row, the 32pt code row, and the section-button row (14 + 60 +
 * 12). The loading skeleton uses it so the section area doesn't jump when
 * the real header arrives.
 */
const HEADER_HEIGHT = 8 + 44 + 32 + 14 + 60 + 12;

type Loaded = { club: Club; role: ClubRole | null; coverUrl: string | null };
type State = { status: 'loading' } | { status: 'failed' } | ({ status: 'ready' } & Loaded);

/** The last route segment, e.g. `games` in `clubs/[id]/(hub)/games`. */
function sectionFrom(segments: string[]): HubSection {
  const last = segments[segments.length - 1];
  return HUB_SECTIONS.find((s) => s.key === last)?.key ?? 'games';
}

export default function ClubHubLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const segments = useSegments() as string[];
  const active = sectionFrom(segments);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, loading } = useSession();
  const userId = session?.user.id;
  const [state, setState] = useState<State>({ status: 'loading' });
  // Guards a stale load (the id changed, or the layout unmounted) from
  // overwriting a newer one.
  const loadSeq = useRef(0);

  /**
   * `background` is a reload of an already-ready hub (pull to refresh,
   * after a settings change): a failure there keeps what is on screen
   * rather than replacing the whole hub with the error screen. Only the
   * initial load (and Retry) can show the failure screen.
   */
  const fetchAll = useCallback(async (background: boolean): Promise<void> => {
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
  }, [id, userId]);

  const load = useCallback(() => fetchAll(false), [fetchAll]);
  const reloadClub = useCallback(() => fetchAll(true), [fetchAll]);

  useEffect(() => {
    setState({ status: 'loading' });
    void load();
    return () => {
      loadSeq.current += 1;
    };
  }, [load]);

  // Club settings is pushed over the hub, which stays mounted beneath it,
  // so a cover, colour or code changed there would otherwise not show when
  // the organizer comes back. Every focus after the first reloads in the
  // background; the first is the mount, which the load above covers.
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      void reloadClub();
    }, [reloadClub]),
  );

  const context = useMemo<ClubHubValue | null>(
    () =>
      state.status === 'ready'
        ? { club: state.club, role: state.role, reloadClub }
        : null,
    [state, reloadClub],
  );

  if (!loading && !session) return <Redirect href="/sign-in" />;

  if (state.status === 'failed') {
    return (
      <Screen center contentStyle={styles.failed}>
        <BackRow label="Home" accessibilityLabel="Back to home" onPress={() => router.replace('/home')} />
        <Text style={styles.failedText}>Could not load this club.</Text>
        <Button
          variant="secondary"
          big={false}
          accessibilityLabel="Retry"
          onPress={() => {
            setState({ status: 'loading' });
            void load();
          }}
        >
          Retry
        </Button>
      </Screen>
    );
  }

  if (loading || state.status === 'loading' || !context) {
    return (
      <View style={styles.fill}>
        <View
          testID="club-hub-header-skeleton"
          style={[
            styles.skeleton,
            { height: insets.top + HEADER_HEIGHT, paddingTop: insets.top + 8 },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to home"
            onPress={() => router.replace('/home')}
            style={styles.skeletonBack}
          >
            <ChevronLeftIcon size={24} color="#fff" />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ClubHubContext.Provider value={context}>
      <View style={styles.fill}>
        <ClubHubHeader
          club={context.club}
          coverUrl={state.status === 'ready' ? state.coverUrl : null}
          canManage={context.role ? canInvite(context.role) : false}
          active={active}
          onBack={() => router.replace('/home')}
          onSettings={() => router.push(`/clubs/${id}/settings`)}
          onSelect={(s) => router.replace(`/clubs/${id}/${s}`)}
        />
        <Slot />
      </View>
    </ClubHubContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  skeleton: { backgroundColor: COVER_COLORS[0].value, paddingHorizontal: 8 },
  // Same 44pt back target, in the same spot, as ClubHubHeader's.
  skeletonBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  failed: { padding: 16, gap: 16, alignItems: 'flex-start' },
  failedText: { fontFamily: type.bodyRegular, fontSize: type.size.body, color: colors.text },
});
