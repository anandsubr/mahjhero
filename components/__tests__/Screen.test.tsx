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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import Screen from '../Screen';

// react-native-web's real RefreshControl renders as a plain, inert `View`
// (see node_modules/react-native-web/src/exports/RefreshControl) -- there is
// no native pull gesture in a browser, so it never calls `onRefresh` or
// shows `refreshing` in the DOM on its own. Swapping in a button that
// exposes both is the only way, in jsdom, to prove `Screen` actually wires
// its `onRefresh`/`refreshing` state into the prop the ScrollView receives,
// per the brief's suggestion to mock `RefreshControl` for this.
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    RefreshControl: (props: { refreshing: boolean; onRefresh?: () => void }) => (
      <button
        type="button"
        aria-label="refresh-control"
        data-refreshing={props.refreshing}
        onClick={() => props.onRefresh?.()}
      />
    ),
  };
});

/** A child that proves whether it survived a rerender: its own local
 *  state, bumped by a tap, has nowhere to come back from if this
 *  component was ever unmounted and remounted. */
function Counter() {
  const [count, setCount] = useState(0);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Bump"
      onPress={() => setCount((c) => c + 1)}
    >
      <Text testID="count">{count}</Text>
    </Pressable>
  );
}

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

  // A caller's `footer` is routinely a `condition ? <ActionBar /> : null`
  // (Notifications' dirty-form save bar, the game screen's RoundTimer while
  // the game is live) -- it flips between an element and `null` on the same
  // mounted Screen as state changes elsewhere on the page. `body` used to
  // sit at the tree's root when `footer` was absent and one level deeper
  // once it appeared, a different position for the same subtree that made
  // React remount it (and everything inside, including the ScrollView)
  // every time `footer` flipped -- silently discarding a mid-edit TimeField
  // or the current scroll position. This pins that `body`'s own children
  // never remount across that flip, regardless of which way it flips.
  it('does not remount children when footer toggles between an element and null', () => {
    const { rerender } = render(
      <Screen scroll footer={null}>
        <Counter />
      </Screen>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bump' }));
    expect(screen.getByTestId('count').textContent).toBe('1');

    rerender(
      <Screen scroll footer={<Text>Save</Text>}>
        <Counter />
      </Screen>,
    );
    expect(screen.getByTestId('count').textContent).toBe('1');

    rerender(
      <Screen scroll footer={null}>
        <Counter />
      </Screen>,
    );
    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('wires onRefresh into the ScrollView refreshControl and tracks refreshing', async () => {
    let resolveRefresh: () => void = () => {};
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    render(
      <Screen scroll onRefresh={onRefresh}>
        <Text testID="a">A</Text>
      </Screen>,
    );

    const control = screen.getByLabelText('refresh-control');
    expect(control.getAttribute('data-refreshing')).toBe('false');

    fireEvent.click(control);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(control.getAttribute('data-refreshing')).toBe('true'));

    resolveRefresh();
    await waitFor(() => expect(control.getAttribute('data-refreshing')).toBe('false'));
  });

  it('does not render a refreshControl when onRefresh is not given', () => {
    render(
      <Screen scroll>
        <Text testID="a">A</Text>
      </Screen>,
    );
    expect(screen.queryByLabelText('refresh-control')).toBeNull();
  });
});
