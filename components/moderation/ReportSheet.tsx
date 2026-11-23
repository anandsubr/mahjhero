import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from '../Text';
import ErrorBanner from '../ErrorBanner';
import { sheetStyles } from './ActionSheet';
import {
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  REPORT_THANKS,
  reportContent,
  type ReportKind,
  type ReportReason,
} from '../../lib/moderation';
import { colors, radius, type } from '../../lib/theme';

type Props = {
  kind: ReportKind;
  targetId: string;
  /** e.g. "Report this message". */
  title?: string;
  onClose: () => void;
};

/**
 * Pick a reason, optionally say more, Submit. On success the sheet turns
 * into the confirmation, closed with Done.
 */
export default function ReportSheet({ kind, targetId, title = 'Report', onClose }: Props) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await reportContent({ kind, targetId, reason, details });
    setSubmitting(false);
    if (result.error) setError(result.error);
    else setSent(true);
  }

  const canSubmit = reason !== null && !submitting;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={sheetStyles.root}>
        <Pressable
          style={sheetStyles.scrim}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={sheetStyles.sheet} testID="report-sheet">
          <View style={sheetStyles.grabber} />
          {sent ? (
            <>
              <Text style={sheetStyles.title} accessibilityLiveRegion="polite">
                {REPORT_THANKS}
              </Text>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Done"
                style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]}
              >
                <Text style={styles.primaryText}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={sheetStyles.title}>{title}</Text>
              <Text style={styles.helper}>Why are you reporting this?</Text>
              <View style={styles.list} accessibilityRole="radiogroup">
                {REPORT_REASONS.map((r, i) => {
                  const selected = r.value === reason;
                  return (
                    <Pressable
                      key={r.value}
                      onPress={() => setReason(r.value)}
                      accessibilityRole="radio"
                      accessibilityLabel={r.label}
                      accessibilityState={{ checked: selected }}
                      aria-checked={selected}
                      style={[styles.row, i > 0 && styles.divided]}
                    >
                      <View style={[styles.radio, selected && styles.radioOn]}>
                        {selected ? <View style={styles.radioDot} /> : null}
                      </View>
                      <Text style={styles.rowText}>{r.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Anything else we should know? (optional)"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Details (optional)"
                multiline
                maxLength={REPORT_DETAILS_MAX}
                style={styles.input}
              />
              {error ? <ErrorBanner message={error} /> : null}
              <Pressable
                onPress={() => void submit()}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel="Submit"
                aria-disabled={!canSubmit}
                aria-busy={submitting}
                style={({ pressed }) => [
                  styles.primary,
                  pressed && canSubmit && styles.primaryPressed,
                  !canSubmit && !submitting && styles.primaryDisabled,
                ]}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.primaryText, !canSubmit && styles.primaryTextDisabled]}>Submit</Text>
                )}
              </Pressable>
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={sheetStyles.cancel}
              >
                <Text style={sheetStyles.cancelText}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  helper: {
    fontFamily: type.bodyRegular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.neutral[800],
  },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  rowText: { fontFamily: type.bodySemiBold, fontSize: 16, color: colors.text },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.neutral[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.accent[700] },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent[700],
  },
  input: {
    minHeight: 72,
    maxHeight: 140,
    borderRadius: 16,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: type.bodyRegular,
    fontSize: 16,
    color: colors.text,
    textAlignVertical: 'top',
  },
  primary: {
    height: 50,
    marginTop: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPressed: { backgroundColor: colors.accent[800] },
  primaryDisabled: { backgroundColor: colors.accent[300] },
  primaryText: { fontFamily: type.bodyBold, fontSize: 16, color: '#fff' },
  primaryTextDisabled: { color: colors.accent[100] },
});
