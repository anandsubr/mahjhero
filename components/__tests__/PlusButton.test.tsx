import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlusButton from '../PlusButton';

describe('PlusButton', () => {
  it('fires onPress when tapped', () => {
    const onPress = vi.fn();
    render(<PlusButton onPress={onPress} accessibilityLabel="Start a club" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start a club' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('carries whatever accessible label it is given', () => {
    render(<PlusButton onPress={() => {}} accessibilityLabel="Add a game" />);
    expect(screen.getByRole('button', { name: 'Add a game' })).toBeTruthy();
  });
});
