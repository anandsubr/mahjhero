import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchDismissedGuides, saveDismissedGuides, type GuideKey } from './guides';
import { useSession } from './session';

type Guides = {
  isVisible: (key: GuideKey) => boolean;
  dismiss: (key: GuideKey) => void;
  reset: () => Promise<boolean>;
};

/**
 * The default — what a screen sees with no provider above it — shows
 * nothing. Every existing screen test renders without a provider, so the
 * guides stay out of their way; tests that want a guide visible mock this
 * module's `useGuides`.
 */
const GuidesContext = createContext<Guides>({
  isVisible: () => false,
  dismiss: () => {},
  reset: async () => false,
});

export function GuidesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  // Keyed on the user id, not the session object: lib/session.tsx hands out
  // a fresh Session on every TOKEN_REFRESHED (see lib/use-unread.ts).
  const userId = session?.user.id ?? null;
  // null = unknown (not loaded, or the read failed) → everything hidden.
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  // Mirrors `dismissed` synchronously so two dismissals in one tick both land.
  const latest = useRef<string[] | null>(null);
  // Tracks the account a pending `reset()` was issued for, kept current by
  // the load effect below (not the `userId` closed over by `reset` itself,
  // which is frozen at the point `reset` was called). Lets `reset`'s
  // resolution notice an account switch that happened while its save was
  // in flight.
  const userIdRef = useRef<string | null>(null);
  // Bumped by every `dismiss()`. Lets a pending `reset()` notice, on
  // resolution, whether a dismissal landed while its save was in flight.
  const generation = useRef(0);

  useEffect(() => {
    userIdRef.current = userId;
    setDismissed(null);
    latest.current = null;
    if (!userId) return;
    let cancelled = false;
    fetchDismissedGuides(userId).then((keys) => {
      if (cancelled) return;
      latest.current = keys;
      setDismissed(keys);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const dismiss = useCallback(
    (key: GuideKey) => {
      if (!userId || latest.current === null || latest.current.includes(key)) return;
      const next = [...latest.current, key];
      latest.current = next;
      generation.current += 1;
      setDismissed(next);
      // Fire-and-forget: a failed save leaves it hidden for this session and
      // it may come back next time. No banner — this is not worth one.
      void saveDismissedGuides(userId, next);
    },
    [userId],
  );

  const reset = useCallback(async () => {
    if (!userId) return false;
    const resetUserId = userId;
    const generationAtStart = generation.current;
    // What reset is about to clear. On a generation mismatch below,
    // `latest.current` may hold both these pre-reset keys AND keys dismissed
    // while the save was in flight — only the latter should survive.
    const snapshotAtStart = latest.current ?? [];
    const ok = await saveDismissedGuides(userId, []);
    if (ok) {
      if (userIdRef.current !== resetUserId) {
        // The signed-in account changed while this save was in flight — its
        // result belongs to an account that's no longer current. Leave
        // whatever the new account has loaded (or not loaded) alone.
        return ok;
      }
      if (generation.current === generationAtStart) {
        latest.current = [];
        setDismissed([]);
      } else {
        // A dismiss() landed while this reset's save was in flight.
        // Re-saving `latest.current` as-is would include whatever was
        // dismissed BEFORE reset started too (`snapshotAtStart`), silently
        // reverting the reset for those keys while `reset()` still reports
        // success. Keep only the keys dismissed after reset began, locally
        // and on the server, so the server's last write matches local state
        // instead of racing the two writes.
        const survivors = (latest.current ?? []).filter((k) => !snapshotAtStart.includes(k));
        latest.current = survivors;
        setDismissed(survivors);
        void saveDismissedGuides(resetUserId, survivors);
      }
    }
    return ok;
  }, [userId]);

  const value = useMemo<Guides>(
    () => ({
      isVisible: (key) => dismissed !== null && !dismissed.includes(key),
      dismiss,
      reset,
    }),
    [dismissed, dismiss, reset],
  );

  return <GuidesContext.Provider value={value}>{children}</GuidesContext.Provider>;
}

export function useGuides(): Guides {
  return useContext(GuidesContext);
}
