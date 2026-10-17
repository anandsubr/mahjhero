import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../../../../components/Text';
import Button from '../../../../components/Button';
import ClubBoard, { type ClubBoardHandle } from '../../../../components/ClubBoard';
import BoardComposer from '../../../../components/board/BoardComposer';
import HubSection from '../../../../components/hub/HubSection';
import { useClubHub } from '../../../../components/hub/ClubHubContext';
import { canAnnounce } from '../../../../lib/clubs';
import { openThreadForClub } from '../../../../lib/messages';
import { colors, type } from '../../../../lib/theme';

/**
 * The club hub's Board section: the same root-posts list
 * app/messages/club/[threadId]/index.tsx renders, reached from the hub (the
 * inbox no longer lists boards). `open_thread_for_club` resolves the club's
 * single thread, so this section and that route always show the SAME
 * thread -- there is no second thread-creation path to keep in sync.
 *
 * The thread id is fetched once per club (not on every focus): unlike the
 * posts themselves, which board.tsx wants a Retry-able ready/failed state
 * fetching that thread id, the id itself never changes for a club, and
 * ClubBoard already refetches its own posts on focus and over realtime.
 *
 * The composer is pinned in HubSection's footer (outside the scroller); a
 * successful post reloads the board so the new post shows first. Hosts and
 * co-organizers also get the composer's megaphone toggle (post + email the
 * club), from the role the hub layout already resolved.
 */
export default function BoardSection() {
  const { club, role } = useClubHub();
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

  const onPosted = useCallback(() => {
    void boardRef.current?.reload();
  }, []);

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
    <HubSection
      avoidKeyboard
      onRefresh={onRefresh}
      footer={
        <BoardComposer
          threadId={threadId}
          onPosted={onPosted}
          clubId={club.id}
          canAnnounce={role !== null && canAnnounce(role)}
        />
      }
    >
      <ClubBoard ref={boardRef} threadId={threadId} />
    </HubSection>
  );
}

const styles = StyleSheet.create({
  loading: { marginTop: 24 },
  failed: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  failedText: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.text },
});
