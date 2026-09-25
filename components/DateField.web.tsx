import type { ChangeEvent, CSSProperties } from 'react';
import { Text, View } from 'react-native';
import { dateStringToDate } from '../lib/time';
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
  /**
   * The game form's chip ("Thu 24 Sept"): a small pill showing the date,
   * with the real input laid transparently over it so a tap still opens
   * the browser's own picker.
   */
  compact?: boolean;
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
  compact = false,
}: DateFieldProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.value === '') return;
    onChange(event.target.value);
  }

  if (compact) {
    return (
      <View style={chipStyle}>
        <Text style={chipTextStyle}>{value ? formatChipDate(value) : 'Pick a date'}</Text>
        <input
          type="date"
          value={value}
          onChange={handleChange}
          min={minimum}
          aria-label={label}
          onClick={(event) => {
            // Chrome only opens its calendar from the icon; showPicker makes
            // a tap anywhere on the chip do it.
            try {
              event.currentTarget.showPicker?.();
            } catch {
              // Not allowed outside a user gesture in some browsers -- the
              // native click still focuses the input.
            }
          }}
          style={overlayStyle}
        />
      </View>
    );
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

function formatChipDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(dateStringToDate(value));
}

const chipStyle = {
  position: 'relative' as const,
  height: 38,
  paddingHorizontal: 14,
  borderRadius: radius.pill,
  backgroundColor: colors.bg,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

const chipTextStyle = {
  fontFamily: type.bodySemiBold,
  fontSize: 15,
  color: colors.text,
};

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
  cursor: 'pointer',
  border: 0,
  padding: 0,
  margin: 0,
};
