import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import MahjongTile from '../MahjongTile';

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
});
