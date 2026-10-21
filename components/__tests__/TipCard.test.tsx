import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TipCard, { TipText } from '../TipCard';
import { colors } from '../../lib/theme';

describe('TipCard', () => {
  it('shows its tag, title and body', () => {
    render(
      <TipCard tag="Tip" title="Getting a seat" onDismiss={() => {}}>
        <TipText>Tap Join to take a spot.</TipText>
      </TipCard>,
    );
    expect(screen.getByText('Tip')).toBeTruthy();
    expect(screen.getByText('Getting a seat')).toBeTruthy();
    expect(screen.getByText('Tap Join to take a spot.')).toBeTruthy();
  });

  it('calls onDismiss from "Got it", labelled by title', () => {
    const onDismiss = vi.fn();
    render(<TipCard title="Getting a seat" onDismiss={onDismiss}><TipText>x</TipText></TipCard>);
    fireEvent.click(screen.getByRole('button', { name: 'Got it: Getting a seat' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders an optional action', () => {
    const onPress = vi.fn();
    render(
      <TipCard title="T" onDismiss={() => {}} action={{ label: 'Add a game', onPress }}>
        <TipText>x</TipText>
      </TipCard>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add a game' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // Linen & Jade §4: the lime (accent2[100]) fill becomes blush accent[100].
  it('fills the card with blush accent[100]', () => {
    render(<TipCard testID="tip" title="T" onDismiss={() => {}}><TipText>x</TipText></TipCard>);
    const card = screen.getByTestId('tip').firstElementChild as HTMLElement;
    const hex = colors.accent[100];
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(getComputedStyle(card).backgroundColor).toBe(`rgb(${r}, ${g}, ${b})`);
  });
});
