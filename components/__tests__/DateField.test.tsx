/**
 * DateField's Android "open the picker" state has to reach the DOM, not just
 * the React tree.
 *
 * The bug this file exists to keep closed: this button sent
 * `accessibilityState={{ expanded: open }}`, which react-native-web's
 * createDOMProps has no handling for at all (see components/Toggle.tsx's
 * docstring for the full account). Same fix, same reasoning: a flat
 * `aria-expanded` reaches both platforms, because React Native's own
 * `Pressable` resolves `expanded: ariaExpanded ?? accessibilityState
 * ?.expanded`.
 *
 * This particular control is Android-only -- components/DateField.web.tsx is
 * the file the web build actually ships (see vitest.config.ts's
 * `resolve.extensions`, which makes every OTHER component test resolve the
 * `.web.tsx` variant, same as the real web bundle) -- so it never reaches
 * react-native-web's DOM on a shipped web build. It is still worth pinning
 * here: the flat prop is now the pattern this app standardizes on, real
 * native Android's own Pressable resolves it exactly the same way, and this
 * is the only layer below Maestro that can render this branch at all.
 *
 * Getting there needs two things no other component test in this repo
 * needs:
 *   - An explicit `.tsx` import, bypassing the `.web.tsx`-first resolution
 *     `vitest.config.ts` sets up, so this test exercises the actual native
 *     file rather than the web counterpart.
 *   - `Platform.OS` forced to `'android'`, per vitest.config.ts's own CAVEAT
 *     comment: the `react-native` -> `react-native-web` alias hardcodes
 *     `Platform.OS === 'web'`, so the Android branch is otherwise
 *     unreachable. `importOriginal` keeps every other react-native-web
 *     export (View, Pressable, Text, StyleSheet, ...) real; only `Platform`
 *     is overridden.
 *
 * `@react-native-community/datetimepicker` is stubbed to a no-op: it is a
 * real native module with no web build, was deliberately un-stubbed
 * globally when nothing imported it any more (vitest.config.ts's comment on
 * the alias block), and nothing about its own behaviour is under test here
 * -- only the open/closed Pressable it sits behind.
 *
 * `toHaveAttribute`-style assertions are written as an explicit
 * `getAttribute` comparison on purpose, matching Toggle.test.tsx: asserting
 * only `not.toBe('true')` would pass for a completely absent attribute,
 * which is exactly the defect this file exists to catch.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, Platform: { ...actual.Platform, OS: 'android' } };
});

vi.mock('@react-native-community/datetimepicker', () => ({
  default: () => null,
}));

import DateField from '../DateField.tsx';

describe('DateField (Android)', () => {
  it('renders aria-expanded="false" before the picker is opened', () => {
    render(<DateField value="" onChange={() => {}} label="Date" />);
    const button = screen.getByRole('button', { name: 'Date' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders aria-expanded="true" once the picker is opened', () => {
    render(<DateField value="" onChange={() => {}} label="Date" />);
    const button = screen.getByRole('button', { name: 'Date' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
