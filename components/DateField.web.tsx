import type { ChangeEvent, CSSProperties } from 'react';
import { View } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

type DateFieldProps = {
  /** "YYYY-MM-DD", or "" for a date the host has not chosen yet. */
  value: string;
  onChange: (next: string) => void;
  label: string;
  /**
   * "YYYY-MM-DD", rendered as the input's `min`. See the native
   * components/DateField.tsx for why every caller passes today.
   *
   * `min` is a courtesy, not a control: it greys out earlier days in the
   * browser's own calendar popup and marks the field `:invalid`, but it does
   * not block a typed value or a submit. The refusal that actually holds is
   * supabase/migrations/20260824001000's, in the database.
   */
  minimum?: string;
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
 * A cleared input reports "". A date the caller is already holding is never
 * given up for nothing — the empty change is ignored and the previous value
 * kept — which makes the invalid state unreachable rather than merely
 * rejected, the same reasoning TimeField.web.tsx documents for its own
 * empty-string case. (An empty `value` passed IN is fine and means "not
 * chosen yet": the browser renders the control's own empty state.)
 *
 * Covered by app/__tests__/events-new.test.tsx, which fires a "" change at
 * the "Date" field and asserts the previously picked date is what the screen
 * still sends. Deleting the guard below turns that test red.
 */
export default function DateField({
  value,
  onChange,
  label,
  minimum,
}: DateFieldProps) {
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
        min={minimum}
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
