import { useEffect, useState } from 'react';
import { initialsFrom } from './dashboard';
import { fetchProfile } from './profile';
import { useSession } from './session';

/**
 * The signed-in member's initials, for the avatar every header draws.
 *
 * Three screens want this — the dashboard, the club screen and the venue
 * screen — and the dashboard was deriving it from its own state and its own
 * fetch inside a mount effect that already had four other jobs. One hook
 * instead of three copies of the same effect.
 *
 * Keyed on `session?.user.id`, NOT on `session`: lib/session.tsx hands out a
 * fresh Session object on every onAuthStateChange, TOKEN_REFRESHED included,
 * which fires within the hour and on web tab focus. Depending on the object
 * would refetch every time for a value that only changes on a real account
 * switch. The same reasoning app/profile.tsx already records for its own
 * fetch.
 *
 * `''` is a real answer rather than an error state, and it is what all three
 * failure-ish paths produce: no session, a member who never set a display
 * name (a magic-link signup starts with `display_name = ''` and nothing
 * forces one), and a failed read — `fetchProfile` resolves null on any
 * failure rather than rejecting. DashboardHeader draws a person glyph for
 * the empty string rather than inventing a letter the member never chose, so
 * all three degrade to the same honest thing.
 */
export function useViewerInitials(): string {
  const { session } = useSession();
  const userId = session?.user.id;
  const [initials, setInitials] = useState('');

  useEffect(() => {
    if (!userId) {
      setInitials('');
      return;
    }
    let cancelled = false;
    fetchProfile(userId).then((profile) => {
      if (cancelled) return;
      setInitials(initialsFrom(profile?.display_name ?? ''));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return initials;
}
