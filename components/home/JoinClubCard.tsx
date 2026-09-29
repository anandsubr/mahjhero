import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../Text';
import { joinClubByCode, normalizeClubCode } from '../../lib/clubs';
import { colors, radius, type } from '../../lib/theme';

/** "Join a club" by code (Design V3 2a, Clubs). Instant join; errors inline. */
export default function JoinClubCard({ onJoined }: { onJoined: (clubId: string) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy || code.length === 0;

  async function submit() {
    if (disabled) return;
    setBusy(true);
    setError(null);
    const result = await joinClubByCode(code);
    setBusy(false);
    if (result.error || !result.clubId) {
      setError(result.error);
      return;
    }
    setCode('');
    onJoined(result.clubId);
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Join a club</Text>
      <View style={styles.row}>
        <TextInput
          accessibilityLabel="Club code"
          placeholder="Club code"
          placeholderTextColor={colors.neutral[600]}
          value={code}
          onChangeText={(t) => {
            setCode(normalizeClubCode(t));
            setError(null);
          }}
          onSubmitEditing={() => void submit()}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={16}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Join"
          disabled={disabled}
          onPress={() => void submit()}
          style={[styles.join, disabled && styles.joinDisabled]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.joinText, disabled && styles.joinTextDisabled]}>Join</Text>
          )}
        </Pressable>
      </View>
      {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 24, padding: 16, gap: 10 },
  title: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.bg,
    paddingHorizontal: 16, fontFamily: type.bodyBold, fontSize: 16, letterSpacing: 2, color: colors.text,
  },
  join: {
    minWidth: 76, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.accent[700],
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18,
  },
  joinDisabled: { backgroundColor: colors.neutral[300] },
  joinText: { fontFamily: type.bodyBold, fontSize: 16, color: '#fff' },
  joinTextDisabled: { color: colors.neutral[600] },
  error: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.accent[700] },
});
