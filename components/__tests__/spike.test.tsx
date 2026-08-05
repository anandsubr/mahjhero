import { afterEach, describe, expect, it } from 'vitest';
import { Text, View } from 'react-native';
import { cleanup, render as renderDom, screen } from '@testing-library/react';

// @testing-library/react's automatic afterEach cleanup only registers when it
// detects a global `afterEach` (see cleanup-after-each in its source: `typeof
// afterEach === 'function'`). This repo's vitest.config.mts does not set
// `test.globals: true`, so no such global exists and DOM nodes from one test
// leak into the next unless cleanup() is called explicitly here.
afterEach(cleanup);

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
