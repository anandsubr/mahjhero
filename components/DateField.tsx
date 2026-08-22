import DateTimePicker, {
  type DateTimePickerChangeEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { dateStringToDate, dateToDateString } from '../lib/time';
import { colors, radius, space, type } from '../lib/theme';

type DateFieldProps = {
  /** "YYYY-MM-DD", or "" for a date the host has not chosen yet. */
  value: string;
  onChange: (next: string) => void;
  label: string; // accessibility label, e.g. "Date"
};

/**
 * Native (iOS/Android) date picker. components/DateField.web.tsx is the web
 * counterpart — Metro's platform-extension resolution picks whichever file
 * matches the build target, so this file (and the native-only
 * @react-native-community/datetimepicker it imports) never reaches the web
 * bundle.
 *
 * The platform split mirrors components/TimeField.tsx exactly, and for the
 * same reasons: iOS renders a compact inline control that expands into a
 * popover, while Android's picker is not a visible control at all — mounting
 * it immediately opens the native modal dialog — so Android needs a visible
 * Pressable of its own, with the picker mounted only while it is open.
 *
 * An empty `value` means "no date chosen yet" — the optional "Stop repeating
 * on" field on the create-a-game screen starts there, because the alternative
 * (showing some date the host never picked) puts a value on screen that is
 * not the one being sent. `dateStringToDate('')` would be an Invalid Date and
 * the native picker cannot render one, so the picker anchors on today while
 * the Android button says so in words rather than naming a date.
 */
export default function DateField({ value, onChange, label }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const hasValue = value.length > 0;
  const date = hasValue ? dateStringToDate(value) : new Date();

  function handleValueChange(
    _event: DateTimePickerChangeEvent,
    nextDate: Date,
  ) {
    setOpen(false);
    onChange(dateToDateString(nextDate));
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
          accessibilityState={{ expanded: open }}
        >
          <Text style={styles.androidButtonText}>
            {hasValue ? date.toLocaleDateString() : 'Pick a date'}
          </Text>
        </Pressable>
        {open ? (
          <DateTimePicker
            value={date}
            mode="date"
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
        mode="date"
        display="compact"
        onValueChange={handleValueChange}
        accessibilityLabel={label}
        style={styles.iosPicker}
        // Tints the native compact picker's button with the design system's
        // accent colour — the one styling hook the native control exposes;
        // its chrome is otherwise system-drawn (see TimeField.tsx's identical
        // comment).
        accentColor={colors.accentColor}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  iosPicker: {
    // The library sizes itself; this only stops it from stretching past its
    // content width.
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
