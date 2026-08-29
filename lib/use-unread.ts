import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { fetchUnreadCounts } from './messages';
import { useSession } from './session';

export type UnreadCounts = { total: number; byClub: Record<string, number> };

const EMPTY: UnreadCounts = { total: 0, byClub: {} };

/**
 * One RPC serving both badges: a total for the Messages tab and a per-club
 * breakdown for the dashboard's chips. `my_unread_counts` returns one row
 * per club plus one with a null club_id covering groups and directs, and the
 * total is their sum.
 *
 * Two RPCs would mean two round trips on every tab screen for one badge —
 * and my_unread_counts is derived from fetch_my_threads, so the badges and
 * the list cannot disagree about what is unread.
 *
 * Refetched on focus rather than held live. Realtime is confined to the open
 * thread; see app/messages/[threadId].tsx for why.
 *
 * Failure resolves to zero rather than an error state. A badge is an
 * invitation, and there is nothing useful to say to somebody about a count
 * we could not fetch.
 */
export function useUnreadCounts(): UnreadCounts {
  const { session } = useSession();
  // Keyed on the user id, NOT on `session` — see lib/use-viewer.ts's
  // docstring and app/profile.tsx's identical comment. lib/session.tsx hands
  // out a fresh Session object on every onAuthStateChange (TOKEN_REFRESHED
  // included, which fires within the hour and on web tab focus); depending
  // on the object itself would refire this focus effect, and the RPC behind
  // it, for a value that only changes on a real account switch.
  const userId = session?.user.id;
  const [counts, setCounts] = useState<UnreadCounts>(EMPTY);

  useFocusEffect(
    useCallback(() => {
      if (!userId) {
        setCounts(EMPTY);
        return;
      }
      let cancelled = false;

      void fetchUnreadCounts().then((rows) => {
        if (cancelled) return;
        if (!rows) {
          setCounts(EMPTY);
          return;
        }
        const byClub: Record<string, number> = {};
        let total = 0;
        for (const row of rows) {
          total += row.unread;
          if (row.club_id) byClub[row.club_id] = row.unread;
        }
        setCounts({ total, byClub });
      });

      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  return counts;
}
