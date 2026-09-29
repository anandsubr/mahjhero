import { StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Text';
import { normalizeClubCode } from '../../lib/clubs';
import { colors, radius, type } from '../../lib/theme';

/** Club code input: shows uppercase with spaces removed as the person types.
 *  Used by Start a club and the club page. */
export default function ClubCodeField({
  value,
  onChangeText,
  label,
  helper,
  error,
}: {
  value: string;
  onChangeText: (v: string) => void;
  label: string;
  helper?: string;
  error?: string | null;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={(t) => onChangeText(normalizeClubCode(t))}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={16}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontFamily: type.bodyBold, fontSize: 15, color: colors.text },
  input: {
    minHeight: 48, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.neutral[400],
    paddingHorizontal: 16, fontFamily: type.bodyBold, fontSize: 17, letterSpacing: 2,
    color: colors.text, backgroundColor: colors.bg,
  },
  helper: { fontFamily: type.bodyRegular, fontSize: 14, color: colors.neutral[700] },
  error: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.accent[700] },
});
