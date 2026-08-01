import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // React Native's own package ships Flow-typed source that Vitest's
      // parser cannot handle. react-native-web is plain, pre-compiled JS
      // and is a safe stand-in for unit tests that only need Platform,
      // etc. to resolve, not real native behavior.
      'react-native': 'react-native-web',
    },
  },
  test: {
    env: {
      // Placeholder values so lib/supabase.ts's env-var guard is satisfied
      // when it is imported transitively during unit tests. Real values
      // live in .env.local and are used by the Expo dev/build tooling.
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    },
  },
});
