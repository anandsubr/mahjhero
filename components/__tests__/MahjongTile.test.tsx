import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MahjongTile from '../MahjongTile';
import type { MahjongSuit } from '../MahjongTile';

describe('MahjongTile', () => {
  it('renders a label only for size="tab"', () => {
    const { rerender } = render(<MahjongTile suit="dots" size="tab" label="Club" />);
    expect(screen.getByText('Club')).toBeTruthy();

    rerender(<MahjongTile suit="dots" size="section" />);
    expect(screen.queryByText('Club')).toBeNull();
  });

  it('renders the red dragon character for suit="red-dragon"', () => {
    render(<MahjongTile suit="red-dragon" size="tab" label="Profile" />);
    expect(screen.getByText('中')).toBeTruthy();
  });

  it('renders the green dragon character for suit="green-dragon"', () => {
    render(<MahjongTile suit="green-dragon" size="tab" label="Alerts" />);
    expect(screen.getByText('發')).toBeTruthy();
  });

  it('is hidden from assistive tech -- purely decorative chrome, the caller supplies any real label', () => {
    render(<MahjongTile suit="dots" size="section" />);
    // react-native-web's flat aria-hidden, the same convention TileHero
    // itself uses (app/welcome.tsx) for exactly this kind of decoration.
    expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });

  it('does not throw for every suit at both sizes', () => {
    const suits = ['dots', 'bamboo', 'red-dragon', 'green-dragon'] as const;
    for (const suit of suits) {
      for (const size of ['tab', 'section'] as const) {
        expect(() =>
          render(<MahjongTile suit={suit} size={size} label={size === 'tab' ? 'X' : undefined} />),
        ).not.toThrow();
      }
    }
  });

  it('renders all four wind characters', () => {
    const winds: { suit: MahjongSuit; char: string }[] = [
      { suit: 'east-wind', char: '東' },
      { suit: 'south-wind', char: '南' },
      { suit: 'west-wind', char: '西' },
      { suit: 'north-wind', char: '北' },
    ];
    for (const { suit, char } of winds) {
      const { unmount } = render(<MahjongTile suit={suit} size="tab" label="X" />);
      expect(screen.getByText(char)).toBeTruthy();
      unmount();
    }
  });

  it('renders a chip-size tile with a glyph and a short label (initials), no larger label styling', () => {
    render(<MahjongTile suit="dots" size="chip" label="RM" />);
    expect(screen.getByText('RM')).toBeTruthy();
  });

  it('renders no label for size="section" even if one is passed', () => {
    render(<MahjongTile suit="dots" size="section" label="RM" />);
    expect(screen.queryByText('RM')).toBeNull();
  });

  // Minor #4 from the final whole-branch review: `Glyph` above falls
  // through to the bamboo SVG shape for any suit that is neither `'dots'`
  // nor a key of its own `CHARACTER_GLYPHS` map -- so a 9th `ClubGlyph`
  // (lib/dashboard.ts, deliberately kept structurally identical to this
  // file's own `MahjongSuit`) added without a matching `CHARACTER_GLYPHS`
  // entry, or without extending the SVG branch, would compile fine and
  // silently render the wrong shape. There is no runtime reflection over a
  // TypeScript union's own members, so this can't catch a FUTURE 9th
  // member on its own -- what it does is lock in that today's 8 are each
  // individually, distinctly verified: every member of `MahjongSuit`
  // renders something suit-specific, one at a time, so an editor who
  // extends this hardcoded list without also extending `Glyph` sees their
  // new member fail immediately, rather than silently inheriting bamboo's
  // shape. (A count-only check -- e.g. `Object.keys(CHARACTER_GLYPHS).length
  // + 2 === 8` -- was considered instead, but it would pass even under a
  // transposition bug where two suits' characters were swapped; asserting
  // the actual rendered glyph per suit is a strictly stronger, equally
  // simple signal, and doesn't require exporting `CHARACTER_GLYPHS` just
  // for a test to import.)
  it('renders something suit-specific for every member of MahjongSuit', () => {
    const ALL_SUITS: MahjongSuit[] = [
      'dots',
      'bamboo',
      'red-dragon',
      'green-dragon',
      'east-wind',
      'south-wind',
      'west-wind',
      'north-wind',
    ];
    const CHARACTERS: Partial<Record<MahjongSuit, string>> = {
      'red-dragon': '中',
      'green-dragon': '發',
      'east-wind': '東',
      'south-wind': '南',
      'west-wind': '西',
      'north-wind': '北',
    };
    for (const suit of ALL_SUITS) {
      const { unmount } = render(<MahjongTile suit={suit} size="tab" label="X" />);
      const character = CHARACTERS[suit];
      if (character) {
        expect(screen.getByText(character)).toBeTruthy();
      } else {
        // dots/bamboo carry no text of their own -- their SVG's own
        // suit-keyed testID (components/MahjongTile.tsx's `glyph-${suit}`)
        // is the only suit-distinguishing signal either has, the same
        // idiom app/__tests__/nav-glyph-parity.test.tsx already relies on.
        expect(screen.getByTestId(`glyph-${suit}`)).toBeTruthy();
      }
      unmount();
    }
  });
});
