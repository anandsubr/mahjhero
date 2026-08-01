import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => setSession(nextSession),
    );

    return () => subscription.subscription.unsubscribe();
  }, []);

  return (
    <SessionContext.Provider value={resolveSessionState(session)}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
