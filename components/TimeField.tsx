import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { ChevronDownIcon } from './icons';
import { dateToTimeString, formatTimeLabel, timeStringToDate } from '../lib/time';
import { colors, radius, space, type } from '../lib/theme';

type TimeFieldProps = {
  value: string; // "HH:MM"
  onChange: (next: string) => void;
  label: string; // accessibility label, e.g. "Quiet hours start"
  /** The game form's chip: a small pill rather than a full-width field. */
  compact?: boolean;
  /** Notifications' quiet-hours tile: this small label ("From"/"Until")
   *  over the time in the heading face, with a chevron. */
  tileLabel?: string;
};

/**
 * Native (iOS/Android) time picker. components/TimeField.web.tsx is the web
 * counterpart — Metro's platform-extension resolution picks whichever file
 * matches the build target, so this file (and the native-only
 * @react-native-community/datetimepicker it imports) never reaches the web
 * bundle.
 *
 * iOS and Android intentionally render differently here, because the
 * library's own "display" behavior differs enough between platforms that a
 * single shared JSX tree would fight one platform or the other:
 *
 * - iOS uses display="compact": a small button showing the current time
 *   that expands into a native popover on tap. It stays inline in the
 *   start/end row exactly like the TextInput it replaces. display="inline"
 *   was considered and rejected — it renders a full permanently-visible
 *   wheel, which is too tall to put two of side by side (start and end) in
 *   one row.
 * - Android's <DateTimePicker> is not a visible inline control at all:
 *   mounting it immediately opens the native TimePickerDialog (a modal),
 *   which is also what the task calls for. So the visible control here is a
 *   plain Pressable showing the current time, and the picker is mounted
 *   only while `open` is true, then unmounted on selection or dismissal.
 */
export default function TimeField({ value, onChange, label, compact = false, tileLabel }: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const date = timeStringToDate(value);

  function handleValueChange(
    _event: DateTimePickerChangeEvent,
    nextDate: Date,
  ) {
    setOpen(false);
    onChange(dateToTimeString(nextDate));
  }

  function handleDismiss() {
    setOpen(false);
  }

  if (tileLabel !== undefined) {
    // iOS keeps its native compact picker inside the tile (its button is
    // system-drawn, as on the game form's time chip); Android shows the
    // time itself and opens the dialog on tap.
    return (
      <View style={styles.tile}>
        <Text style={styles.tileLabel}>{tileLabel}</Text>
        {Platform.OS === 'android' ? (
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={styles.tileValueRow}
          >
            <Text style={styles.tileValue}>{formatTimeLabel(date)}</Text>
            <ChevronDownIcon size={16} color={colors.neutral[600]} />
          </Pressable>
        ) : (
          <DateTimePicker
            value={date}
            mode="time"
            display="compact"
            onValueChange={handleValueChange}
            accessibilityLabel={label}
            style={styles.iosPicker}
            accentColor={colors.accentColor}
            minuteInterval={15}
          />
        )}
        {Platform.OS === 'android' && open ? (
          <DateTimePicker
            value={date}
            mode="time"
            display="default"
            onValueChange={handleValueChange}
            onDismiss={handleDismiss}
          />
        ) : null}
      </View>
    );
  }

  if (Platform.OS === 'android') {
    return (
      <View style={compact ? null : styles.container}>
        <Pressable
          style={compact ? styles.chip : styles.androidButton}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text style={compact ? styles.chipText : styles.androidButtonText}>{formatTimeLabel(date)}</Text>
        </Pressable>
        {open ? (
          <DateTimePicker
            value={date}
            mode="time"
            display="default"
            onValueChange={handleValueChange}
            onDismiss={handleDismiss}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={compact ? null : styles.container}>
      <DateTimePicker
        value={date}
        mode="time"
        display="compact"
        onValueChange={handleValueChange}
        accessibilityLabel={label}
        style={styles.iosPicker}
        // Tints the native compact picker's button with the design system's
        // accent colour. This is the one styling hook the native control
        // exposes — its chrome is otherwise system-drawn and cannot be
        // themed further (radius, background, etc. are not visible until
        // the popover opens, which iOS draws itself).
        accentColor={colors.accentColor}
        // Caps the popover's minute wheel to :00/:15/:30/:45, matching the
        // step on the web input below -- a game's start time never needed
        // finer than that. iOS-only: the library does not support this on
        // Android's system TimePickerDialog (the `display="default"` branch
        // above), which has no equivalent control to restrict.
        minuteInterval={15}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  chip: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    paddingTop: 10,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderRadius: 16,
    backgroundColor: colors.bg,
  },
  tileLabel: { fontFamily: type.bodySemiBold, fontSize: 12, color: colors.neutral[700] },
  tileValueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileValue: { flex: 1, fontFamily: type.heading, fontSize: 22, color: colors.text },
  chipText: { fontFamily: type.bodySemiBold, fontSize: 15, color: colors.text },
  iosPicker: {
    // The library sizes itself; this only stops it from stretching past its
    // content width and squeezing the "to" label between the two fields.
    alignSelf: 'flex-start',
  },
  androidButton: {
    // Matches components/TextField.tsx's `.input` treatment: surface
    // background, divider border, pill radius, "big" sizing.
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    minHeight: 58,
    paddingHorizontal: space[5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The app's "big" input size (19px, 58px min-height) — matches
  // components/TextField.tsx so this reads as the same input treatment.
  androidButtonText: {
    fontFamily: type.bodyRegular,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
});
