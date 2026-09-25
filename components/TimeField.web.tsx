import type { ChangeEvent, CSSProperties } from 'react';
import { Text, View } from 'react-native';
import { ChevronDownIcon } from './icons';
import { formatTimeLabel, timeStringToDate } from '../lib/time';
import { colors, radius, space, type } from '../lib/theme';

type TimeFieldProps = {
  value: string; // "HH:MM"
  onChange: (next: string) => void;
  label: string; // accessibility label, e.g. "Quiet hours start"
  /** The game form's chip ("11:30 PM"): the real select laid transparently
   *  over a small pill, so a tap still opens the browser's own list. */
  compact?: boolean;
  /** Notifications' quiet-hours tile ("From"/"Until" over the time in the
   *  heading face), the select laid transparently over the whole tile. */
  tileLabel?: string;
};

/**
 * Every quarter-hour slot in a day, "00:00".."23:45" -- 96 options.
 *
 * A real <input type="time"> with `step={900}` was tried first, on the
 * theory that the step attribute would cap the picker to these same four
 * minutes per hour. It doesn't: `step` only constrains keyboard/arrow-key
 * increments and form validation, not what the native OS picker itself
 * displays -- confirmed live on a real phone, whose picker still scrolled
 * through all 60 minutes regardless. A plain <select> sidesteps the
 * problem entirely: the browser can only ever offer the options actually
 * in its list, identically on every platform, with no native-picker quirk
 * left to work around.
 */
const TIME_OPTIONS: string[] = [];
for (let hour = 0; hour < 24; hour++) {
  for (const minute of [0, 15, 30, 45]) {
    TIME_OPTIONS.push(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }
}

/**
 * Web counterpart to components/TimeField.tsx. Metro's platform-extension
 * resolution (the .web.tsx suffix) picks this file for web builds instead
 * of the native one, so @react-native-community/datetimepicker — a native
 * module with no web implementation — never enters the web bundle.
 *
 * A single <select> keeps the same "HH:MM" value/onChange/label contract
 * every existing caller and test already uses (a two-control hour+minute
 * split would need a second aria-label and a second change event to
 * drive), and "HH:MM" is still the exact shape lib/profile.ts stores and
 * TIME_PATTERN checks -- no Date conversion, so still no use of
 * lib/time.ts's Date-based helpers for the value itself (only
 * `formatTimeLabel` below, for each option's display text).
 *
 * `value` can carry a minute this list doesn't offer -- a quiet-hours
 * preference saved before this file existed, or one this app never
 * actually constrained. Rather than silently snapping it to the nearest
 * quarter-hour (changing what was saved without being asked), that exact
 * value is added as its own extra option, so it keeps displaying correctly
 * until the member explicitly picks something else.
 *
 * No visible <label> is rendered, matching the TextInputs this replaces
 * (app/notifications.tsx put the visible structure — "Quiet hours", the
 * "to" between the two fields — around the inputs, not on them); aria-label
 * is what a screen reader announces, same role as the native side's
 * accessibilityLabel.
 */
export default function TimeField({ value, onChange, label, compact = false, tileLabel }: TimeFieldProps) {
  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange(event.target.value);
  }

  const options = TIME_OPTIONS.includes(value)
    ? TIME_OPTIONS
    : [...TIME_OPTIONS, value].sort();

  if (tileLabel !== undefined) {
    return (
      <View style={tileStyle}>
        <Text style={tileLabelStyle}>{tileLabel}</Text>
        <View style={tileValueRowStyle}>
          <Text style={tileValueStyle}>{formatTimeLabel(timeStringToDate(value))}</Text>
          <ChevronDownIcon size={16} color={colors.neutral[600]} />
        </View>
        <select value={value} onChange={handleChange} aria-label={label} style={overlayStyle}>
          {options.map((time) => (
            <option key={time} value={time}>
              {formatTimeLabel(timeStringToDate(time))}
            </option>
          ))}
        </select>
      </View>
    );
  }

  if (compact) {
    return (
      <View style={chipStyle}>
        <Text style={chipTextStyle}>{formatTimeLabel(timeStringToDate(value))}</Text>
        <select value={value} onChange={handleChange} aria-label={label} style={overlayStyle}>
          {options.map((time) => (
            <option key={time} value={time}>
              {formatTimeLabel(timeStringToDate(time))}
            </option>
          ))}
        </select>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <select value={value} onChange={handleChange} aria-label={label} style={webSelectStyle}>
        {options.map((time) => (
          <option key={time} value={time}>
            {formatTimeLabel(timeStringToDate(time))}
          </option>
        ))}
      </select>
    </View>
  );
}

// Plain DOM style object (px units required — unlike React Native's
// StyleSheet, a raw <select> does not treat bare numbers as pixels), matching
// components/TextField.tsx's "big" pill input treatment (surface
// background, pill radius, 19px/58px sizing) so this reads as the same
// control on web as the native picker does on iOS/Android.
const webSelectStyle: CSSProperties = {
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
};

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

const tileStyle = {
  position: 'relative' as const,
  flex: 1,
  minWidth: 0,
  gap: 2,
  paddingTop: 10,
  paddingHorizontal: 14,
  paddingBottom: 12,
  borderRadius: 16,
  backgroundColor: colors.bg,
};

const tileLabelStyle = { fontFamily: type.bodySemiBold, fontSize: 12, color: colors.neutral[700] };

const tileValueRowStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 };

const tileValueStyle = { flex: 1, fontFamily: type.heading, fontSize: 22, color: colors.text };

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
