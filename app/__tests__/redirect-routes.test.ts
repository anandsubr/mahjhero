import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every path handed to `Linking.createURL` becomes a URL a browser will
 * actually navigate to after a magic link or an OAuth round trip. expo-router
 * routes by file, so a redirect target with no matching route file is a 404 —
 * the member clicks the link in their email and lands on nothing.
 *
 * This is not hypothetical. `sendMagicLink` gained
 * `emailRedirectTo: Linking.createURL('auth/callback')` to fix native
 * deep-linking, and `app/auth/callback.tsx` did not exist. Web sign-in broke
 * and stayed broken: native masks it entirely, because `openAuthSessionAsync`
 * intercepts the URL for OAuth and the root deep-link handler intercepts a
 * link tapped in Mail, so no screen ever renders there. Only the web build
 * genuinely navigates.
 *
 * Nothing else catches this. The visual suite screenshots three known routes
 * and never exercises routing; the component tests mock `expo-router` outright.
 * So this test reads the redirect paths out of the source and asserts each one
 * resolves to a real route.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const LIB_DIR = join(HERE, '..', '..', 'lib');

/** Pull every literal passed to Linking.createURL out of a source file. */
function redirectPathsIn(source: string): string[] {
  const matches = source.matchAll(/Linking\.createURL\(\s*['"`]([^'"`]+)['"`]/g);
  return [...matches].map((m) => m[1]);
}

/** Collect redirect paths across the whole lib/ directory, not one known file. */
function allRedirectPaths(): string[] {
  const found = new Set<string>();
  for (const entry of readdirSync(LIB_DIR)) {
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    if (entry.includes('.test.')) continue;
    const source = readFileSync(join(LIB_DIR, entry), 'utf8');
    for (const path of redirectPathsIn(source)) found.add(path);
  }
  return [...found];
}

/**
 * expo-router resolves `foo/bar` to either `app/foo/bar.tsx` or
 * `app/foo/bar/index.tsx`. Platform variants (`.web.tsx`, `.ios.tsx`) count
 * too — Metro picks one per platform, so any of them means the route exists.
 */
function routeExistsFor(routePath: string): boolean {
  const clean = routePath.replace(/^\/+/, '').replace(/\?.*$/, '');
  const candidates = [
    `${clean}.tsx`,
    `${clean}.web.tsx`,
    `${clean}.ios.tsx`,
    `${clean}.android.tsx`,
    join(clean, 'index.tsx'),
    join(clean, 'index.web.tsx'),
  ];
  return candidates.some((candidate) => existsSync(join(APP_DIR, candidate)));
}

describe('auth redirect targets resolve to real routes', () => {
  const paths = allRedirectPaths();

  it('finds redirect paths to check', () => {
    // Guards the test itself: if createURL is renamed or the call moves out of
    // lib/, this suite would otherwise pass by checking nothing at all.
    expect(paths.length).toBeGreaterThan(0);
  });

  it.each(paths)('has a route file for "%s"', (routePath) => {
    expect(
      routeExistsFor(routePath),
      `lib/ redirects to "${routePath}" but no route file exists under app/. ` +
        `On web the browser navigates there and gets a 404. Create ` +
        `app/${routePath}.tsx.`,
    ).toBe(true);
  });
});
