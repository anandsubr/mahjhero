import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    // expo-modules-core (pulled in transitively by expo-linking /
    // expo-web-browser, used by lib/auth.ts's OAuth flow) references the
    // bare global `__DEV__`, which Metro injects at bundle time in a real
    // Expo app but which does not exist under Vitest/Node. Without this,
    // importing lib/auth.ts throws `ReferenceError: __DEV__ is not defined`
    // before any test in the file can run.
    __DEV__: 'true',
  },
  resolve: {
    alias: {
      // React Native's own package ships Flow-typed source that Vitest's
      // parser cannot handle. react-native-web is plain, pre-compiled JS
      // and is a safe stand-in for unit tests that only need Platform,
      // etc. to resolve, not real native behavior.
      //
      // CAVEAT: react-native-web hardcodes `Platform.OS === 'web'`. Every
      // test therefore sees the web platform, so platform-branching code
      // (lib/supabase.ts picks AsyncStorage and detectSessionInUrl by
      // platform) has its native branch invisible to this suite. A test
      // that needs the native branch must override explicitly, e.g.
      // vi.mock('react-native', () => ({ Platform: { OS: 'ios' } })).
      // Asserting native behaviour without that override silently tests web.
      'react-native': 'react-native-web',
    },
  },
  test: {
    environment: 'jsdom',
    env: {
      // Placeholder values so lib/supabase.ts's env-var guard is satisfied
      // when it is imported transitively during unit tests. Real values
      // live in .env.local and are used by the Expo dev/build tooling.
      //
      // Note this means the guard's throw path is never exercised here; a
      // test wanting to cover it must clear these for that spec.
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    },
  },
});
