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
    fontFamily: type.bodySemiBold,
    fontSize: type.size.helper,
    color: colors.text,
  },
  input: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    minHeight: 58,
    paddingHorizontal: space[5],
    fontFamily: type.bodyRegular,
    fontSize: type.size.bodyLarge,
    color: colors.text,
  },
});
