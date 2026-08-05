import type { ChangeEvent, CSSProperties } from 'react';
import { View } from 'react-native';

type TimeFieldProps = {
  value: string; // "HH:MM"
  onChange: (next: string) => void;
  label: string; // accessibility label, e.g. "Quiet hours start"
};

/**
 * Web counterpart to components/TimeField.tsx. Metro's platform-extension
 * resolution (the .web.tsx suffix) picks this file for web builds instead
 * of the native one, so @react-native-community/datetimepicker — a native
 * module with no web implementation — never enters the web bundle.
 *
 * A real <input type="time"> already speaks the app's native currency:
 * its value getter/setter is "HH:MM" in 24-hour form, the exact shape
 * lib/profile.ts stores and TIME_PATTERN checks. No Date conversion (and
 * so no use of lib/time.ts's helpers) is needed on this path at all — that
 * module exists for the native pickers, which only work in Date objects.
 *
 * No visible <label> is rendered, matching the TextInputs this replaces
 * (app/notifications.tsx put the visible structure — "Quiet hours", the
 * "to" between the two fields — around the inputs, not on them); aria-label
 * is what a screen reader announces, same role as the native side's
 * accessibilityLabel.
 */
export default function TimeField({ value, onChange, label }: TimeFieldProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onChange(event.target.value);
  }

  return (
    <View style={{ flex: 1 }}>
      <input
        type="time"
        value={value}
        onChange={handleChange}
        aria-label={label}
        style={webInputStyle}
      />
    </View>
  );
}

// Plain DOM style object (px units required — unlike React Native's
// StyleSheet, a raw <input> does not treat bare numbers as pixels), matching
// the visual weight of the timeInput style it replaces in
// app/notifications.tsx.
const webInputStyle: CSSProperties = {
  border: '1px solid #999',
  borderRadius: 8,
  padding: 16,
  // 18pt minimum body text app-wide (this player base skews older) — this
  // is exactly what the member reads to confirm the time they picked.
  fontSize: 18,
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};
