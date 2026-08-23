import { Pressable, StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';

type ToggleProps = {
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel: string;
};

/**
 * A hand-drawn on/off switch, matching the design's own toggle exactly
 * (62x34 pill track, 28px cream knob) rather than React Native's platform
 * `Switch`. That component was tried first, but RN Web does not apply
 * `thumbColor` to the "on" state the way native iOS/Android does — the knob
 * fell back to Chromium's own accent colour (a teal that isn't anywhere in
 * the Organic palette) on web while looking correct on iOS/Android. Since
 * `Switch` is also styled differently per platform by design (a native
 * look, not a themeable one), matching this app's design system on all
 * three platforms needed a component the design system actually draws
 * itself, not one each OS renders its own way.
 *
 * `accessibilityRole="switch"` plus `aria-checked` is what keeps this
 * announced by a screen reader as a switch with its current state — the same
 * information the native `Switch` it replaces provided via `value`.
 *
 * `aria-checked`, and NOT `accessibilityState={{ checked: value }}`, which is
 * what this component used to send. That prop reaches the DOM on exactly no
 * platform this app ships to: react-native-web's createDOMProps destructures
 * the flat `accessibilityChecked` and the raw `aria-checked` prop and has no
 * handling for `accessibilityState` at all (node_modules/react-native-web/
 * dist/modules/createDOMProps/index.js, ~line 56 and ~line 212), so every
 * Toggle on web rendered `role="switch"` with no state on it — a screen
 * reader could not tell an on switch from an off one, including the "Other
 * clubs can use this venue" switch that decides whether a member's home
 * address becomes public.
 *
 * One prop covers both platforms rather than two that could drift: React
 * Native's own Pressable resolves `checked: ariaChecked ?? accessibilityState
 * ?.checked` (node_modules/react-native/Libraries/Components/Pressable/
 * Pressable.js:229), so `aria-checked` is what the native accessibility tree
 * gets too.
 *
 * components/__tests__/Toggle.test.tsx asserts the rendered `aria-checked`
 * attribute in both states; reverting this prop to `accessibilityState` turns
 * it red.
 */
export default function Toggle({ value, onValueChange, accessibilityLabel }: ToggleProps) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      aria-checked={value}
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, value ? styles.trackOn : styles.trackOff]}
    >
      <View style={styles.knob} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 62,
    height: 34,
    borderRadius: 999,
    padding: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  trackOn: {
    backgroundColor: colors.accentColor,
    justifyContent: 'flex-end',
  },
  trackOff: {
    backgroundColor: colors.neutral[400],
    justifyContent: 'flex-start',
  },
  knob: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: colors.bg,
  },
});
