import { forwardRef, type ElementRef } from 'react';
import {
  Text as RNText,
  TextInput as RNTextInput,
  type TextInputProps,
  type TextProps,
} from 'react-native';

/**
 * React Native's Text and TextInput, with the phone's text-size setting
 * (iOS Larger Text / Dynamic Type, Android font scale) switched off by
 * default: the app's layouts are drawn at fixed sizes, and at the larger
 * accessibility sizes tab labels wrapped mid-word ("Message / s"), club
 * names truncated to "My own…" and buttons broke across lines.
 *
 * Every screen and component imports Text/TextInput from here, never from
 * 'react-native' directly -- app/__tests__/fixed-font-size-imports.test.ts
 * fails if one does. A caller can still opt back in with
 * `allowFontScaling`.
 */
export const Text = forwardRef<ElementRef<typeof RNText>, TextProps>(function Text(props, ref) {
  return <RNText allowFontScaling={false} {...props} ref={ref} />;
});

export const TextInput = forwardRef<ElementRef<typeof RNTextInput>, TextInputProps>(
  function TextInput(props, ref) {
    return <RNTextInput allowFontScaling={false} {...props} ref={ref} />;
  },
);
