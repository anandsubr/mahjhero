import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ThreadAvatar from '../ThreadAvatar';

/**
 * The avatar treatment components/ThreadRow.tsx already renders per thread
 * kind, factored out here so the thread screen's header (app/messages/
 * [threadId].tsx) can reuse it at a larger size rather than carrying a
 * second copy that can drift. ThreadRow.test.tsx still covers the treatment
 * end to end through the list row; these tests cover the shared component
 * directly, including the size/testID knobs only the header call site uses.
 */
describe('ThreadAvatar', () => {
  it('shows initials for a club thread', () => {
    render(<ThreadAvatar kind="club" name="Riverside" />);
    expect(screen.getByTestId('thread-avatar-club').textContent).toBe('R');
  });

  it('shows the other member’s initials for a direct thread', () => {
    render(<ThreadAvatar kind="direct" name="Bob Reyes" />);
    expect(screen.getByTestId('thread-avatar-direct').textContent).toBe('BR');
  });

  it('shows a people glyph, not initials, for a group thread', () => {
    render(<ThreadAvatar kind="group" name="Weekend crew" />);
    expect(screen.getByTestId('thread-avatar-group').textContent).toBe('');
  });

  it('shows a calendar glyph, not initials, for a game thread', () => {
    render(<ThreadAvatar kind="game" name="Tuesday Night" />);
    expect(screen.getByTestId('thread-avatar-game').textContent).toBe('');
  });

  // The header call site needs a bigger avatar than the 52px list row --
  // and a testID of its own, so it can be found alongside a differently
  // sized list row without colliding on the same id.
  it('accepts a custom size and testID', () => {
    render(<ThreadAvatar kind="club" name="Riverside" size={72} testID="thread-header-avatar-club" />);
    const avatar = screen.getByTestId('thread-header-avatar-club');
    expect(getComputedStyle(avatar).width).toBe('72px');
    expect(getComputedStyle(avatar).height).toBe('72px');
  });

  it('renders the plain circle by default, even for kind="club"', () => {
    render(<ThreadAvatar kind="club" name="Riverside Mah Jongg" />);
    expect(screen.getByTestId('thread-avatar-club')).toBeTruthy();
    expect(screen.queryByText('RM')).toBeTruthy(); // initials, same as before
  });

  it('renders a mahjong tile instead of a circle when asTile is true', () => {
    render(
      <ThreadAvatar kind="club" name="Riverside Mah Jongg" clubId="club-1" asTile size={72} />,
    );
    expect(screen.queryByTestId('thread-avatar-club')).toBeNull();
    expect(screen.getByText('RM')).toBeTruthy();
  });

  it('renders the same glyph for the same club id across re-renders', () => {
    const { rerender } = render(
      <ThreadAvatar kind="club" name="Riverside Mah Jongg" clubId="club-1" asTile size={72} />,
    );
    const first = screen.getByTestId('thread-avatar-club-tile').textContent;
    rerender(
      <ThreadAvatar kind="club" name="Riverside Mah Jongg" clubId="club-1" asTile size={72} />,
    );
    expect(screen.getByTestId('thread-avatar-club-tile').textContent).toBe(first);
  });

  it('ignores asTile for non-club kinds', () => {
    render(<ThreadAvatar kind="direct" name="Ada" asTile />);
    // Still the plain circle -- asTile only ever does anything for kind="club".
    expect(screen.getByTestId('thread-avatar-direct')).toBeTruthy();
  });

  // Minor #6 from the final whole-branch review: `asTile` needs a `clubId`
  // to derive a glyph from (see the component's own guard, `kind === 'club'
  // && asTile && clubId`) -- a caller that passes `asTile` without one must
  // not crash, and must not silently render nothing either. It falls
  // through to the very next branch, the OLD plain circle, same as
  // `asTile={false}` would.
  it('falls back to the plain circle when asTile is true but clubId is missing, without crashing', () => {
    expect(() =>
      render(<ThreadAvatar kind="club" name="Riverside Mah Jongg" asTile />),
    ).not.toThrow();
    expect(screen.getByTestId('thread-avatar-club')).toBeTruthy();
    expect(screen.queryByTestId('thread-avatar-club-tile')).toBeNull();
    expect(screen.getByText('RM')).toBeTruthy();
  });
});
