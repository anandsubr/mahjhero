/**
 * `stickyHeaderIndices` is a pass-through prop: `Screen` forwards it
 * verbatim to the underlying `ScrollView` (see components/Screen.tsx for
 * why a single index there pins react-native-web's actual DOM wrapper, not
 * just a prop that gets silently swallowed). This file exists to pin two
 * things:
 *
 *  1. When a caller passes it, react-native-web's own sticky-header
 *     wrapping actually shows up in the rendered DOM (`position: sticky`) --
 *     proof the prop reached the ScrollView, not just that no crash
 *     happened.
 *  2. When a caller does not pass it (every existing screen, today), the
 *     DOM is bit-for-bit what it was before this prop existed -- no sticky
 *     wrapper `<div>` appears anywhere, and the single wrapped `content`
 *     column is exactly what encloses `children`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Text } from 'react-native';
import Screen from '../Screen';

describe('Screen', () => {
  it('forwards stickyHeaderIndices to the ScrollView, pinning that child', () => {
    render(
      <Screen scroll stickyHeaderIndices={[1]}>
        <Text testID="before">Before</Text>
        <Text testID="sticky-me">Sticky</Text>
        <Text testID="after">After</Text>
      </Screen>,
    );

    const stickyChild = screen.getByTestId('sticky-me');
    // react-native-web's ScrollView wraps exactly the indices named in
    // `stickyHeaderIndices` in a `<div>` styled `position: sticky` -- see
    // node_modules/react-native-web/src/exports/ScrollView/index.js. Walking
    // up from the pinned child's own text node to that wrapper and reading
    // its resolved style is what proves the index actually reached
    // react-native-web's ScrollView, not just that `Screen` accepted the
    // prop without forwarding it.
    let node: HTMLElement | null = stickyChild;
    let stickyAncestor: HTMLElement | null = null;
    while (node) {
      if (getComputedStyle(node).position === 'sticky') {
        stickyAncestor = node;
        break;
      }
      node = node.parentElement;
    }
    expect(stickyAncestor).not.toBeNull();

    // The two non-pinned siblings must NOT have picked up the same
    // treatment -- otherwise this would pass even if `Screen` pinned
    // everything rather than just the named index.
    for (const id of ['before', 'after']) {
      let n: HTMLElement | null = screen.getByTestId(id);
      let sticky = false;
      while (n) {
        if (getComputedStyle(n).position === 'sticky') {
          sticky = true;
          break;
        }
        n = n.parentElement;
      }
      expect(sticky).toBe(false);
    }
  });

  it('leaves the ScrollView exactly as before when stickyHeaderIndices is not given', () => {
    render(
      <Screen scroll>
        <Text testID="a">A</Text>
        <Text testID="b">B</Text>
      </Screen>,
    );

    for (const id of ['a', 'b']) {
      let n: HTMLElement | null = screen.getByTestId(id);
      let sticky = false;
      while (n) {
        if (getComputedStyle(n).position === 'sticky') {
          sticky = true;
          break;
        }
        n = n.parentElement;
      }
      expect(sticky).toBe(false);
    }

    // Both children still render, in order, inside the one scroller --
    // the default single-`content`-wrapper path is otherwise untouched.
    const scroller = screen.getByTestId('screen-scroll');
    const text = scroller.textContent;
    expect(text?.indexOf('A')).toBeGreaterThanOrEqual(0);
    expect(text?.indexOf('B')).toBeGreaterThan(text?.indexOf('A') ?? -1);
  });
});
