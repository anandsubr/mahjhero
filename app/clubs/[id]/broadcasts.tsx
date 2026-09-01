import { useEffect } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import Screen from '../../../components/Screen';
import { openThreadForClub } from '../../../lib/messages';
import { useSession } from '../../../lib/session';
import { colors } from '../../../lib/theme';

/**
 * Was the sent-broadcast history. The club thread IS that history now, with
 * every past broadcast backfilled into it by 20260829060000 — and unlike the
 * old screen it also shows what members said back.
 */
export default function BroadcastsRedirect() {
  const { session, loading } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!session) return;
    if (!id) {
      // Only reachable via a malformed route -- send it to the dashboard
      // rather than falling through to the same spinner this screen uses
      // while loading, which would otherwise never resolve.
      router.replace('/clubs');
      return;
    }
    let cancelled = false;

    void (async () => {
      const result = await openThreadForClub(id);
      if (cancelled) return;
      // The board, not the flat thread screen: this route only ever opens a
      // CLUB thread, and a club's conversation is a board of posts now.
      router.replace(result.id ? `/messages/club/${result.id}` : `/clubs/${id}`);
    })();

    return () => {
      cancelled = true;
    };
  }, [session, id, router]);

  if (loading) {
    return (
      <Screen center>
        <ActivityIndicator color={colors.accentColor} />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <Screen center>
      <ActivityIndicator color={colors.accentColor} />
    </Screen>
  );
}
