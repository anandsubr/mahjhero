import { Stack } from 'expo-router';
import { useAuthDeepLink } from '../lib/auth-deep-link';
import { SessionProvider } from '../lib/session';

export default function RootLayout() {
  // Mounted at the root so a magic link can complete from any screen, and so
  // a cold launch from the link is caught before the first screen renders.
  useAuthDeepLink();

  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
