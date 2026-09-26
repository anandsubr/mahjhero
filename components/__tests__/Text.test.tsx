import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// The props the wrapper hands to React Native's own components, captured
// directly -- react-native-web drops allowFontScaling from the DOM, so the
// rendered output alone can't show it.
const seen = vi.hoisted(() => ({ text: [] as unknown[], input: [] as unknown[] }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  const { forwardRef, createElement } = await import('react');
  return {
    ...actual,
    Text: forwardRef((props: Record<string, unknown>, ref) => {
      seen.text.push(props);
      return createElement(actual.Text as never, { ...props, ref });
    }),
    TextInput: forwardRef((props: Record<string, unknown>, ref) => {
      seen.input.push(props);
      return createElement(actual.TextInput as never, { ...props, ref });
    }),
  };
});

import { Text, TextInput } from '../Text';

describe('components/Text', () => {
  it('turns font scaling off by default', () => {
    render(<Text>Hello</Text>);
    render(<TextInput accessibilityLabel="Name" />);
    expect(seen.text.at(-1)).toMatchObject({ allowFontScaling: false });
    expect(seen.input.at(-1)).toMatchObject({ allowFontScaling: false });
  });

  it('still lets a caller opt back in', () => {
    render(<Text allowFontScaling>Hello</Text>);
    expect(seen.text.at(-1)).toMatchObject({ allowFontScaling: true });
  });

  it('forwards refs', () => {
    const ref = createRef<unknown>();
    render(<TextInput ref={ref as never} accessibilityLabel="Name" />);
    expect(ref.current).toBeTruthy();
  });
});
