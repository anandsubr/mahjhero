import { describe, expect, it, vi } from 'vitest';

// Required just to let `app/index.tsx` load. Importing the real `expo-router`
// under Vitest reaches into `react-native`'s Flow-typed internals in a way
// the `react-native` -> `react-native-web` alias in vitest.config.mts does
// not intercept (same class of problem documented there for
// `@testing-library/react-native`, and the reason every other screen test in
// this directory mocks `expo-router` too) — without this the whole file
// fails to import with `SyntaxError: Unexpected token 'typeof'`, not from
// anything this test actually exercises.
vi.mock('expo-router', () => ({
  Redirect: () => null,
}));

import { resolveIndexRedirect } from '../index';

/**
 * `app/index.tsx` is the one place that decides where a signed-in member
 * lands — `/clubs`, or `/join/<token>` if a club invite is parked in
 * storage from before they signed in. `app/__tests__/redirect-routes.test.ts`
 * only checks that `Linking.createURL` targets in `lib/` resolve to a route
 * file; it says nothing about which `<Redirect href>` a given auth/storage
 * state actually produces. This is that missing coverage.
 *
 * `resolveIndexRedirect` is tested directly as a pure function rather than
 * through a full component render: the interesting branch is a race between
 * a session appearing and an async `AsyncStorage.getItem` read resolving,
 * and asserting on that race through a mocked router/storage would be far
 * more indirect than asserting on the three inputs and one output directly.
 */
describe('resolveIndexRedirect', () => {
  // /welcome, not /sign-in: the welcome screen is the app's front door, and
  // sign-in is a step inside it.
  it('sends a signed-out member to the welcome screen', () => {
    expect(resolveIndexRedirect(false, false, null)).toBe('/welcome');
  });

  it('sends a signed-in member with no parked invite to their clubs', () => {
    expect(resolveIndexRedirect(false, true, null)).toBe('/clubs');
  });

  it('sends a signed-in member with a parked invite to redeem it', () => {
    expect(resolveIndexRedirect(false, true, 'abc123')).toBe('/join/abc123');
  });

  // The async race this task fixed: AsyncStorage.getItem hasn't resolved
  // yet (pendingInvite is still `undefined`, not `null`), so the redirect
  // target genuinely isn't known. Returning `/clubs` here — the bug this
  // guards against — would flash past a real pending invite whenever the
  // storage read is slower than the render.
  it("is undecided (no redirect) while a signed-in member's storage read is still pending", () => {
    expect(resolveIndexRedirect(false, true, undefined)).toBeNull();
  });

  it('is undecided while auth itself is still loading, regardless of storage state', () => {
    expect(resolveIndexRedirect(true, false, undefined)).toBeNull();
    expect(resolveIndexRedirect(true, true, undefined)).toBeNull();
  });
});
