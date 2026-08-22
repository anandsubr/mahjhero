import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { supabase } from './supabase';

export type SessionState = {
  session: Session | null;
  loading: boolean;
};

/**
 * `undefined` means no auth event has arrived yet, so we are still loading.
 * `null` means we asked and there is no session.
 */
export function resolveSessionState(
  session: Session | null | undefined,
): SessionState {
  if (session === undefined) {
    return { session: null, loading: true };
  }
  return { session, loading: false };
}

const SessionContext = createContext<SessionState>({
  session: null,
  loading: true,
});

export type SetSession = Dispatch<SetStateAction<Session | null | undefined>>;

/**
 * The provider's effect, extracted so it can be tested directly — it is plain
 * async plumbing with two racing writers, and both of the guards below exist
 * because of that race rather than because of React.
 *
 * `getSession()` reads persisted storage; `completeAuthRedirect` calls
 * `setSession` from the deep-link handler at almost the same moment on a cold
 * launch from a magic link. auth-js's `lock` defaults to `null`, so nothing
 * serializes them. If the storage read comes back empty but its callback
 * queues behind the SIGNED_IN event, an unguarded write here signs the member
 * straight back out. Hence both branches write only when nothing has arrived
 * yet, leaving whatever onAuthStateChange has already established alone.
 *
 * Returns its own unsubscribe.
 */
export function subscribeToSession(setSession: SetSession): () => void {
  supabase.auth
    .getSession()
    .then(({ data }) =>
      setSession((current) => (current === undefined ? data.session : current)),
    )
    // Corrupt persisted storage or a full storage quota makes this reject.
    // Leaving `session` at `undefined` would hold every screen in the app on
    // a bare ActivityIndicator with no exit — the worst possible outcome of
    // an unhandled rejection here. Resolving to signed-out at least reaches
    // the sign-in screen, from which the member can recover.
    .catch((cause) => {
      console.error('SessionProvider getSession failed', cause);
      setSession((current) => (current === undefined ? null : current));
    });

  // Deliberately unguarded: every later event — SIGNED_IN, SIGNED_OUT,
  // TOKEN_REFRESHED — is newer than anything above and must win.
  const { data: subscription } = supabase.auth.onAuthStateChange(
    (_event, nextSession) => setSession(nextSession),
  );

  return () => subscription.subscription.unsubscribe();
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => subscribeToSession(setSession), []);

  return (
    <SessionContext.Provider value={resolveSessionState(session)}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
