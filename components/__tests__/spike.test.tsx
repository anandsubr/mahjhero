import { describe, expect, it } from 'vitest';
import { Text, View } from 'react-native';
import { render as renderDom, screen } from '@testing-library/react';

function Probe() {
  return (
    <View>
      <Text accessibilityRole="header">Quiet hours</Text>
    </View>
  );
}

describe('testing library spike', () => {
  it('renders a React Native tree and finds text via @testing-library/react', () => {
    renderDom(<Probe />);
    expect(screen.getByText('Quiet hours')).toBeTruthy();
  });

  it('exposes the accessibility role as a queryable attribute', () => {
    renderDom(<Probe />);
    expect(screen.getByRole('heading')).toBeTruthy();
  });
});
