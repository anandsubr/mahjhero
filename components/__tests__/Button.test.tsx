/**
 * Button's computed disabled/busy state has to reach the DOM, not just the
 * React tree.
 *
 * The bug this file exists to keep closed: Button folded its own computed
 * `disabled`/`busy` into `accessibilityState={{ ...accessibilityState,
 * disabled: isDisabled, busy }}`. react-native-web's createDOMProps has no
 * handling for `accessibilityState` at all (node_modules/react-native-web/
 * dist/modules/createDOMProps/index.js — it reads the flat
 * `accessibilityDisabled`/`accessibilityBusy` and the raw `aria-disabled`/
 * `aria-busy` props instead), so every Button-based control in the app
 * rendered with no `aria-disabled` and no `aria-busy` on web. This branch
 * alone adds around fifteen such controls (Join the waitlist, the
 * tier-warning confirm, offer accept/decline, Leave the waitlist, Bring
 * someone, and more to come) whose disabled/loading state was invisible to
 * a screen reader.
 *
 * Same fix, same reasoning as Toggle.tsx's docstring: a flat `aria-*` prop
 * reaches both platforms, because React Native's own `Pressable` resolves
 * `disabled: ariaDisabled ?? accessibilityState?.disabled` (and the
 * equivalent for `busy`).
 *
 * `toHaveAttribute`-style assertions are written as an explicit
 * `getAttribute` comparison on purpose, matching Toggle.test.tsx: asserting
 * only `not.toBe('true')` (or a helper that returns null for a missing
 * attribute) would pass for a completely absent attribute, which is exactly
 * the defect this file exists to catch.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Button from '../Button';

describe('Button', () => {
  it('renders aria-disabled="true" and aria-busy="false" when disabled', () => {
    render(
      <Button onPress={() => {}} disabled accessibilityLabel="Join the waitlist">
        Join the waitlist
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Join the waitlist' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  it('renders no aria-disabled and aria-busy="false" when neither is set', () => {
    render(
      <Button onPress={() => {}} accessibilityLabel="Join the waitlist">
        Join the waitlist
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Join the waitlist' });
    // react-native-web's createDOMProps only emits `aria-disabled` when it is
    // true (see SeatGrid.test.tsx's "renders no aria-disabled on a
    // pressable empty seat" for the same behaviour) -- so the not-disabled
    // case is a genuinely absent attribute, not a `"false"` string.
    expect(button.getAttribute('aria-disabled')).toBeNull();
    // `aria-busy`, unlike `aria-disabled`, IS emitted as a literal `"false"`
    // -- asserted explicitly rather than with `not.toBe('true')`, which a
    // missing attribute (the bug this file exists to catch) would also
    // satisfy.
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  it('renders aria-busy="true" and aria-disabled="true" while loading', () => {
    render(
      <Button onPress={() => {}} loading accessibilityLabel="Join the waitlist">
        Join the waitlist
      </Button>,
    );
    // `loading` renders an ActivityIndicator instead of the label, so the
    // accessible name comes from `accessibilityLabel` on the indicator --
    // query by role directly rather than by name to keep this test about
    // aria-disabled/aria-busy, not label plumbing.
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});
