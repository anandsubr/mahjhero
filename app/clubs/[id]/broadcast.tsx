import { useEffect } from 'react';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator } from 'react-native';
import Screen from '../../../components/Screen';
import { openThreadForClub, openThreadForEvent } from '../../../lib/messages';
import { useSession } from '../../../lib/session';
import { colors } from '../../../lib/theme';

/**
 * Was the broadcast compose screen. Broadcasts are now announcements inside
 * a thread — an organizer writes one in the club or game thread and flips
 * "Also email everyone" — so this route has no screen of its own left.
 *
 * It is a redirect rather than a deletion because these URLs are in members'
 * history and in the footers of already-sent emails. A 404 is not an
 * acceptable answer to a link that worked last week.
 */
export default function BroadcastRedirect() {
  const { session, loading } = useSession();
  const { id, eventId } = useLocalSearchParams<{ id: string; eventId?: string }>();
  const router = useRouter();

  useEffect(() => {
    if (!session || !id) return;
    let cancelled = false;

    void (async () => {
      const result = eventId
        ? await openThreadForEvent(eventId)
        : await openThreadForClub(id);
      if (cancelled) return;
      // A refusal lands on the club screen rather than leaving somebody on a
      // spinner with nowhere to go.
      router.replace(result.id ? `/messages/${result.id}` : `/clubs/${id}`);
    })();

    return () => {
      cancelled = true;
    };
  }, [session, id, eventId, router]);

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
