import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  webServer: {
    // The real production web build, not the dev server — dev-only overlays
    // and HMR markers would pollute the baselines.
    //
    // CRITICAL: the bundle is built against the LOCAL Supabase, not the hosted
    // dev project that .env.local points at. `mintSession` issues tokens from
    // the local stack, and a token minted by one project is not valid for
    // another — build against the hosted project and every signed-in test
    // fails to authenticate for reasons that look like a Playwright problem.
    // These env vars override .env.local for this build only.
    // `-s` (single-page mode) makes `serve` rewrite unmatched paths back to
    // index.html. Required because app.json sets `web.output: "single"`, so
    // `expo export` emits only dist/index.html and relies on expo-router's
    // client-side routing for /sign-in, /profile, /notifications; without
    // `-s`, deep-linking straight to those paths 404s instead of loading
    // the app shell.
    command:
      'EXPO_PUBLIC_SUPABASE_URL="$SUPABASE_LOCAL_URL" ' +
      'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_LOCAL_ANON_KEY" ' +
      'npx expo export -p web && npx serve dist -l 4173 -s',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
  },
  expect: {
    toHaveScreenshot: {
      // An absolute pixel budget, not a ratio.
      //
      // A ratio scales with page size and silently swallows small elements:
      // a 62x34 toggle knob is ~2,100px, which on a 375x812 page is 0.69% —
      // under a 1% ratio. This suite exists *because* a toggle knob rendered
      // in the wrong colour escaped every other test, so a threshold that
      // masks exactly that is worse than useless. A whole-theme accent
      // mutation was empirically shown to pass at 0.01 on notifications-mobile.
      //
      // 120px covers antialiasing jitter between machines while staying far
      // below any single control. Do not raise it to silence a diff — mask a
      // genuinely non-deterministic region instead.
      maxDiffPixels: 120,
    },
  },
});
