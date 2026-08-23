/**
 * Toggle's state has to reach the DOM, not just the React tree.
 *
 * The bug this file exists to keep closed: Toggle sent
 * `accessibilityState={{ checked: value }}`, which react-native-web drops on
 * the floor — createDOMProps reads the flat `accessibilityChecked` and the
 * raw `aria-checked` prop and never looks at `accessibilityState`. Every
 * switch in the app therefore rendered `role="switch"` with no state
 * attribute at all, so a screen-reader user could not tell an on switch from
 * an off one. The one that matters most is VenuePicker's "Other clubs can use
 * this venue", which decides whether a member's home address is published.
 *
 * `toHaveAttribute`-style assertions are written as an explicit
 * `getAttribute` comparison on purpose. Asserting only `not.toBe('false')`
 * (or reading the attribute through a helper that returns null for a missing
 * one) passes for a completely absent attribute, which is exactly the defect
 * — so both states are pinned against their literal expected strings, and the
 * absent case is pinned separately.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Toggle from '../Toggle';

describe('Toggle', () => {
  it('renders aria-checked="true" when it is on', () => {
    render(
      <Toggle value onValueChange={() => {}} accessibilityLabel="Share it" />,
    );
    const toggle = screen.getByRole('switch', { name: 'Share it' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('renders aria-checked="false" when it is off', () => {
    render(
      <Toggle
        value={false}
        onValueChange={() => {}}
        accessibilityLabel="Share it"
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'Share it' });
    // Not `not.toBe('true')`: a missing attribute would satisfy that too, and
    // a missing attribute is the bug.
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('follows the value when it changes, rather than freezing at mount', () => {
    const { rerender } = render(
      <Toggle
        value={false}
        onValueChange={() => {}}
        accessibilityLabel="Share it"
      />,
    );
    expect(
      screen.getByRole('switch').getAttribute('aria-checked'),
    ).toBe('false');

    rerender(
      <Toggle value onValueChange={() => {}} accessibilityLabel="Share it" />,
    );
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('reports the flipped value when pressed', () => {
    const onValueChange = vi.fn();
    render(
      <Toggle
        value={false}
        onValueChange={onValueChange}
        accessibilityLabel="Share it"
      />,
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});
