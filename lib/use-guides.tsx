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

  useEffect(() => {
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
      setDismissed(next);
      // Fire-and-forget: a failed save leaves it hidden for this session and
      // it may come back next time. No banner — this is not worth one.
      void saveDismissedGuides(userId, next);
    },
    [userId],
  );

  const reset = useCallback(async () => {
    if (!userId) return false;
    const ok = await saveDismissedGuides(userId, []);
    if (ok) {
      latest.current = [];
      setDismissed([]);
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
