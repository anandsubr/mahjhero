import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../../../../components/Text';
import Button from '../../../../components/Button';
import ClubBoard, { type ClubBoardHandle } from '../../../../components/ClubBoard';
import HubSection from '../../../../components/hub/HubSection';
import { useClubHub } from '../../../../components/hub/ClubHubContext';
import { openThreadForClub } from '../../../../lib/messages';
import { colors, type } from '../../../../lib/theme';

/**
 * The club hub's Board section: the same root-posts list
 * app/messages/club/[threadId]/index.tsx renders, now reached from the hub
 * rather than only from the Messages list. `open_thread_for_club` is the
 * same RPC that screen's own "open a club row" flow already calls, so this
 * section always lands on the SAME thread that route would -- there is no
 * second thread-creation path to keep in sync.
 *
 * The thread id is fetched once per club (not on every focus): unlike the
 * posts themselves, which board.tsx wants a Retry-able ready/failed state
 * fetching that thread id, the id itself never changes for a club, and
 * ClubBoard already refetches its own posts on focus and over realtime.
 */
export default function BoardSection() {
  const { club } = useClubHub();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const boardRef = useRef<ClubBoardHandle>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const { id, error } = await openThreadForClub(club.id);
    if (error || !id) {
      setFailed(true);
      return;
    }
    setThreadId(id);
  }, [club.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    if (threadId) {
      await boardRef.current?.reload();
    } else {
      await load();
    }
  }, [threadId, load]);

  if (failed) {
    return (
      <HubSection>
        <View style={styles.failed}>
          <Text style={styles.failedText}>Could not load the board.</Text>
          <Button variant="secondary" big={false} accessibilityLabel="Retry" onPress={() => void load()}>
            Retry
          </Button>
        </View>
      </HubSection>
    );
  }

  if (!threadId) {
    return (
      <HubSection>
        <ActivityIndicator style={styles.loading} color={colors.accentColor} />
      </HubSection>
    );
  }

  return (
    <HubSection onRefresh={onRefresh}>
      <ClubBoard ref={boardRef} threadId={threadId} clubId={club.id} showNewPost />
    </HubSection>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 24 },
  failed: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  failedText: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.text },
});
