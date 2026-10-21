import { useEffect } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import Screen from '../../../../components/Screen';
import { fetchThread } from '../../../../lib/messages';
import { useSession } from '../../../../lib/session';
import { colors } from '../../../../lib/theme';

/**
 * Was the standalone club board. A club has one board now: the hub's Board
 * section (`/clubs/{id}/board`). This route stays only so an old email, push
 * or history entry that names `/messages/club/{thread}` still lands
 * somewhere: it resolves the thread's club and forwards there, or to Home if
 * the thread cannot be read.
 */
export default function ClubBoardRedirect() {
  const { session, loading } = useSession();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  const router = useRouter();
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    if (!threadId) {
      router.replace('/home');
      return;
    }
    let cancelled = false;
    void fetchThread(threadId).then((thread) => {
      if (cancelled) return;
      router.replace(thread?.club_id ? `/clubs/${thread.club_id}/board` : '/home');
    });
    return () => {
      cancelled = true;
    };
  }, [userId, threadId, router]);

  if (!loading && !session) return <Redirect href="/sign-in" />;

  return (
    <Screen center>
      <ActivityIndicator color={colors.accentColor} />
    </Screen>
  );
}
