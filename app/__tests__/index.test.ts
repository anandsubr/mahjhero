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
 * lands — `/clubs`, or the welcome screen if signed out.
 * `app/__tests__/redirect-routes.test.ts` only checks that `Linking.createURL`
 * targets in `lib/` resolve to a route file; it says nothing about which
 * `<Redirect href>` a given auth state actually produces. This is that
 * missing coverage.
 *
 * `resolveIndexRedirect` is tested directly as a pure function rather than
 * through a full component render, since its branching has no async or
 * effect-driven behavior to exercise.
 */
describe('resolveIndexRedirect', () => {
  // /welcome, not /sign-in: the welcome screen is the app's front door, and
  // sign-in is a step inside it.
  it('sends a signed-out member to the welcome screen', () => {
    expect(resolveIndexRedirect(false, false)).toBe('/welcome');
  });

  it('sends a signed-in member to their clubs', () => {
    expect(resolveIndexRedirect(false, true)).toBe('/clubs');
  });

  it('is undecided while auth is still loading, regardless of session state', () => {
    expect(resolveIndexRedirect(true, false)).toBeNull();
    expect(resolveIndexRedirect(true, true)).toBeNull();
  });
});
