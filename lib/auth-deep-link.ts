import * as Linking from 'expo-linking';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { completeAuthRedirect } from './auth';

/**
 * Catches the magic-link redirect on native and turns it into a session.
 *
 * Two arrivals have to be covered and they are genuinely different events:
 *
 *  - `getInitialURL()` — the app was not running and the link launched it.
 *    The URL is already waiting; no listener will ever fire for it.
 *  - `addEventListener('url')` — the app was already running (foreground or
 *    background) and the OS delivered the URL to the live process.
 *
 * Handling only one of the two leaves half of real sign-ins stranded, which is
 * why both are wired here rather than picking whichever is easier to test.
 *
 * Deduplication against a redirect that `WebBrowser.openAuthSessionAsync`
 * already consumed lives inside `completeAuthRedirect`, so this hook can stay
 * indifferent to which flow produced the URL.
 *
 * Web is deliberately excluded: lib/supabase.ts sets `detectSessionInUrl` for
 * web only, so auth-js already reads the fragment and then strips it from the
 * address bar. Racing it from here would either double-apply the tokens or
 * read a URL auth-js has already cleaned.
 */
export function useAuthDeepLink(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;

    let cancelled = false;

    Linking.getInitialURL()
      .then((url) => {
        // A late resolution after unmount must not set a session for a screen
        // that is gone; the next mount's getInitialURL will see the same URL.
        if (cancelled || !url) return;
        return completeAuthRedirect(url);
      })
      .catch((cause) => {
        // completeAuthRedirect never rejects, so this can only be
        // getInitialURL itself. Swallowing it keeps an unhandled rejection out
        // of the app; there is nothing the member could do about it anyway.
        console.error('useAuthDeepLink failed', cause);
      });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void completeAuthRedirect(url);
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
}
