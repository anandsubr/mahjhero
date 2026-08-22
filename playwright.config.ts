import { defineConfig } from '@playwright/test';

// Fail fast, before `expo export` burns minutes on a build that cannot work.
//
// Every one of these is interpolated into a shell command or read by
// e2e/session.ts. An unset variable is NOT an error to the shell — it expands
// to the empty string, so the build silently succeeds with an empty Supabase
// URL, lib/supabase.ts's own guard throws in the browser, and all six tests
// fail on `toBeVisible` timeouts. `mintSession`'s guard does not catch that
// case either, because it only checks the URL, which was fine. The result is
// exactly the "looks like a Playwright problem rather than a configuration
// one" failure the webServer comment below warns about — so check here, where
// the message can name the missing variable.
//
// This runs in worker processes too (Playwright re-evaluates the config file
// per worker); that is harmless and correct, since workers call mintSession.
const REQUIRED_ENV = [
  'SUPABASE_LOCAL_URL',
  'SUPABASE_LOCAL_ANON_KEY',
  'SUPABASE_LOCAL_SERVICE_ROLE_KEY',
] as const;

const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(
    `Visual tests need these environment variables, and ${missing.length === 1 ? 'it is' : 'they are'} unset or empty:\n` +
      missing.map((name) => `  - ${name}`).join('\n') +
      '\n\nAll three are printed by `npx supabase status` (start the local ' +
      'stack first). Export them in the shell that runs `npm run test:visual`, ' +
      'e.g.:\n' +
      '  export SUPABASE_LOCAL_URL=http://127.0.0.1:54321\n' +
      '  export SUPABASE_LOCAL_ANON_KEY=<anon key>\n' +
      '  export SUPABASE_LOCAL_SERVICE_ROLE_KEY=<service_role key>\n\n' +
      'The service_role key is for local test setup only — it bypasses RLS ' +
      'and must never reach the app bundle or a hosted project. ' +
      'See docs/testing.md.',
  );
}

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
    // NEVER reuse a server on 4173, not even locally.
    //
    // `reuseExistingServer` skips the *whole* command, and the command is
    // `expo export && serve dist`. So reuse does not just reuse a server — it
    // skips the build. An orphaned `serve` left behind by a killed run (or a
    // `npm run web` on the same port) would make the suite validate whatever
    // `dist/` happened to hold from some earlier build and pass. That is a
    // false green in the one layer whose entire job is preventing false
    // greens, and it would be invisible: the run looks normal and fast.
    //
    // With reuse off, a busy port fails loudly instead — Playwright throws
    // "http://127.0.0.1:4173 is already used", which points straight at the
    // real problem. Kill the stray `serve` and re-run.
    //
    // Moving just the export into `globalSetup` and leaving `serve` here was
    // considered and does not work: Playwright runs webServer plugins BEFORE
    // globalSetup (see `createGlobalSetupTasks` in
    // node_modules/playwright/lib/runner/index.js — plugin setup tasks are
    // ordered ahead of the global-setup tasks), so `serve` would start, and
    // on a fresh checkout fail outright, against a `dist/` that globalSetup
    // had not built yet. Config-module top-level was the other candidate, but
    // Playwright re-evaluates this file in every worker process, so the
    // export would run once per worker unless guarded by undocumented
    // internals. Always rebuilding is the honest cost of this layer.
    reuseExistingServer: false,
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
