import type { ChangeEvent, CSSProperties } from 'react';
import { View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

type DateFieldProps = {
  value: string; // "YYYY-MM-DD"
  onChange: (next: string) => void;
  label: string;
};

/**
 * Web counterpart to components/DateField.tsx, following
 * components/TimeField.web.tsx exactly.
 *
 * <input type="date"> already speaks the app's currency: its value
 * getter/setter is "YYYY-MM-DD", the same shape event_series.starts_on
 * stores, so no Date conversion (and so no use of lib/time.ts's helpers)
 * happens on this path at all.
 *
 * A cleared input reports "". There is no meaningful "no date" for an
 * event, so an empty value is ignored and the previous one kept — which
 * makes the invalid state unreachable rather than merely rejected, the
 * same reasoning TimeField.web.tsx documents for its own empty-string case.
 */
export default function DateField({ value, onChange, label }: DateFieldProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.value === '') return;
    onChange(event.target.value);
  }

  return (
    <View style={{ flex: 1 }}>
      <input
        type="date"
        value={value}
        onChange={handleChange}
        aria-label={label}
        style={webInputStyle}
      />
    </View>
  );
}

// Plain DOM style object (px units required), matching
// components/TextField.tsx's "big" pill input treatment so this reads as the
// same control on web as the native picker does on iOS/Android.
const webInputStyle: CSSProperties = {
  border: `1px solid ${colors.divider}`,
  borderRadius: radius.pill,
  backgroundColor: colors.surface,
  padding: `0 ${space[5]}px`,
  minHeight: 58,
  fontSize: type.size.bodyLarge,
  color: colors.text,
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  caretColor: colors.accentColor,
};
