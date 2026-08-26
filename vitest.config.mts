import { configDefaults, defineConfig } from 'vitest/config';

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
    // Vite has no notion of Metro's platform extensions, so without this an
    // extensionless `import TimeField from '../components/TimeField'`
    // resolves components/TimeField.tsx — the NATIVE file — even though
    // every component test renders through react-native-web and is
    // otherwise a web render. That combination (the native TimeField's iOS
    // branch, with @react-native-community/datetimepicker stubbed to null)
    // is one no shipped platform runs, while components/TimeField.web.tsx —
    // the file the web build actually ships, and where the time-label
    // truncation fix lives — was imported by no test at all.
    //
    // Listing the `.web.*` variants ahead of Vite's defaults makes the
    // component layer resolve the same files the web bundle does, which is
    // what `docs/testing.md` already claims it tests. The remaining entries
    // are Vite's built-in defaults, repeated verbatim because setting this
    // option replaces them rather than extending them.
    extensions: [
      '.web.mjs', '.web.js', '.web.mts', '.web.ts', '.web.jsx', '.web.tsx',
      '.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json',
    ],
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
      // react-native-svg reaches into react-native internals the alias
      // above does not intercept, and cannot be parsed by Vitest. See
      // test/stubs/react-native-svg.tsx for what the stub covers.
      //
      // A '@react-native-community/datetimepicker' stub used to sit here
      // too. `resolve.extensions` above retired it: the only importer of
      // that package is components/TimeField.tsx, and component tests now
      // resolve components/TimeField.web.tsx instead, which never touches
      // it. Nothing under test imports the package any more — and nothing
      // covers it either, at any layer, until Maestro. See docs/testing.md.
      'react-native-svg': new URL(
        './test/stubs/react-native-svg.tsx', import.meta.url,
      ).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // e2e/visual.spec.ts is a Playwright spec (run via `npm run test:visual`,
    // not Vitest) but matches Vitest's default `*.spec.ts` include glob.
    // Without this exclude, Vitest tries to collect it, calling
    // Playwright's `test.describe()` outside a Playwright test run and
    // failing the whole suite even though every real Vitest test passes.
    // Spread the built-in defaults rather than replacing them outright —
    // `test.exclude` overrides Vitest's default array entirely otherwise.
    exclude: [...configDefaults.exclude, 'e2e/**'],
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
