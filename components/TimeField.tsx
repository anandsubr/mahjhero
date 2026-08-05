import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { dateToTimeString, timeStringToDate } from '../lib/time';

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
          <Text style={styles.androidButtonText}>
            {date.toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </Text>
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
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  // 18pt minimum body text (see app/notifications.tsx's other styles for
  // the same rule) — this is exactly what the member reads to confirm the
  // time they picked.
  androidButtonText: { fontSize: 18 },
});
