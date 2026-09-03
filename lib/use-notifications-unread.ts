import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { fetchNotificationUnreadCount } from './notifications';
import { useSession } from './session';

/**
 * The Alerts tab's own badge -- a live count, not cached, matching
 * lib/use-unread.ts's own reasoning for messages: refetched on focus
 * rather than held live (no realtime here either), and a failed fetch
 * resolves to zero rather than an error state, since a badge is an
 * invitation and there is nothing useful to say about a count that could
 * not be fetched.
 */
export function useNotificationsUnread(): number {
  const { session } = useSession();
  // Keyed on the user id, NOT on `session` -- see lib/use-unread.ts's
  // identical comment.
  const userId = session?.user.id;
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setCount(0);
        return;
      }
      let cancelled = false;

      void fetchNotificationUnreadCount()
        .then((result) => {
          if (cancelled) return;
          setCount(result);
        })
        .catch(() => {
          if (cancelled) return;
          setCount(0);
        });

      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  return count;
}
