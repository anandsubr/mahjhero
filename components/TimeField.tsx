import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { dateToTimeString, formatTimeLabel, timeStringToDate } from '../lib/time';
import { colors, radius, space, type } from '../lib/theme';

type TimeFieldProps = {
  value: string; // "HH:MM"
  onChange: (next: string) => void;
  label: string; // accessibility label, e.g. "Quiet hours start"
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
export default function TimeField({ value, onChange, label }: TimeFieldProps) {
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

  if (Platform.OS === 'android') {
    return (
      <View style={styles.container}>
        <Pressable
          style={styles.androidButton}
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text style={styles.androidButtonText}>{formatTimeLabel(date)}</Text>
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
    <View style={styles.container}>
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
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
