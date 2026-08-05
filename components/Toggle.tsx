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
 * `accessibilityRole="switch"` plus `accessibilityState.checked` is what
 * keeps this announced by a screen reader as a switch with its current
 * state — the same information the native `Switch` it replaces provided
 * via `value`.
 */
export default function Toggle({ value, onValueChange, accessibilityLabel }: ToggleProps) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
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
