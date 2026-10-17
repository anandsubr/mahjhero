import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Text } from 'react-native';

// The suite aliases react-native to react-native-web, whose Platform.OS is
// always 'web'; flip it per test, and make KeyboardAvoidingView observable.
const platform = vi.hoisted(() => ({ os: 'web' }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return platform.os;
      },
    },
    KeyboardAvoidingView: ({ children, behavior }: { children: React.ReactNode; behavior?: string }) => (
      <div data-testid="kav" data-behavior={behavior}>
        {children}
      </div>
    ),
  };
});

import HubSection from '../hub/HubSection';

afterEach(() => {
  platform.os = 'web';
});

describe('HubSection avoidKeyboard', () => {
  it('wraps in a padding KeyboardAvoidingView on iOS when set', () => {
    platform.os = 'ios';
    render(
      <HubSection avoidKeyboard footer={<Text>foot</Text>}>
        <Text>body</Text>
      </HubSection>,
    );
    expect(screen.getByTestId('kav').getAttribute('data-behavior')).toBe('padding');
    expect(screen.getByText('foot')).toBeTruthy();
  });

  it('does not wrap on iOS without the prop', () => {
    platform.os = 'ios';
    render(<HubSection><Text>body</Text></HubSection>);
    expect(screen.queryByTestId('kav')).toBeNull();
  });

  it('does not wrap on web even with the prop', () => {
    render(<HubSection avoidKeyboard><Text>body</Text></HubSection>);
    expect(screen.queryByTestId('kav')).toBeNull();
  });
});
