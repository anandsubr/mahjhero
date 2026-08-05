import { Caprasimo_400Regular } from '@expo-google-fonts/caprasimo';
import {
  Figtree_400Regular,
  Figtree_600SemiBold,
  Figtree_700Bold,
} from '@expo-google-fonts/figtree';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useAuthDeepLink } from '../lib/auth-deep-link';
import { SessionProvider } from '../lib/session';

// Keep the splash screen up until the design system's fonts (Caprasimo,
// Figtree) are ready, so headings don't flash in the system face before
// swapping to Caprasimo a beat later. Calling this at module scope means it
// runs before the first render, which is required — a call inside the
// component body can lose the race with that first render on a fast device.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Only rejects if called twice (e.g. Fast Refresh during development);
  // harmless either way, since the screen is already prevented from hiding.
});

export default function RootLayout() {
  // Mounted at the root so a magic link can complete from any screen, and so
  // a cold launch from the link is caught before the first screen renders.
  useAuthDeepLink();

  // useFonts's second element is `error` — set if loading a font failed
  // (bad network on first launch, corrupt cache, etc.) rather than thrown,
  // so a failure here does not crash the app. `fontsReady` treats a load
  // error the same as success: the app must still render in the system
  // face rather than hang on a permanent splash screen waiting for fonts
  // that are never coming. Screens don't need to branch on this — RN
  // silently falls back to the system font for any unresolved
  // fontFamily name.
  const [fontsLoaded, fontError] = useFonts({
    Caprasimo_400Regular,
    Figtree_400Regular,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });
  const fontsReady = fontsLoaded || !!fontError;

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync().catch(() => {
        // Nothing useful to do if hiding the splash screen itself fails;
        // the OS will drop it once the app is interactive regardless.
      });
    }
  }, [fontsReady]);

  if (!fontsReady) {
    // Splash screen is still up at this point, so this render is never
    // seen — returning null just avoids mounting the rest of the tree
    // (and its Supabase session bootstrap) a frame early.
    return null;
  }

  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
