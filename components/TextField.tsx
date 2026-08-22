import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, space, type } from '../lib/theme';

type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label?: string;
};

/**
 * The design system's ".field" + ".input.bigin" combination: a small label
 * above a pill-shaped, 58px-tall input at the app's 19px "big" body size.
 * Every text entry field in the restyled screens uses this — the design
 * treats all inputs as "big" sized, matching this app's larger-target
 * requirement for its older player base.
 */
export default function TextField({ label, ...inputProps }: TextFieldProps) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textMuted}
        cursorColor={colors.accentColor}
        selectionColor={colors.accentColor}
        {...inputProps}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: space[2],
  },
  label: {
    // .field > label { font-size: 12px; margin-bottom: 5px;
    //   color: color-mix(in srgb, text 70%, transparent) } — the 12px base
    // is overridden inline to 16px/margin-bottom 8px throughout the design
    // (and 16 is this app's helper-text floor besides); the 70%-text colour
    // is not overridden anywhere, so it carries through as colors.textLabel.
    // No font-weight override in the design's `.field > label` rule (nor
    // in any inline label markup in 1C-variant.html), so this stays at the
    // body font's regular weight rather than semibold.
    fontFamily: type.bodyRegular,
    fontSize: type.size.helper,
    color: colors.textLabel,
  },
  input: {
    // .input { min-height: 36px; padding: 6px 14px; font-size: 14px;
    //   background: var(--color-surface);
    //   border: 1px solid var(--color-divider); border-radius: 999px;
    //   caret-color: var(--color-accent) }
    // The 36px/14px base is what .bigin (58px/19px) and this app's 18pt
    // floor scale up from; every other rule here (surface bg, divider
    // border, pill radius, accent caret) carries through unscaled.
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    minHeight: 58,
    paddingHorizontal: space[5],
    fontFamily: type.bodyRegular,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
});
