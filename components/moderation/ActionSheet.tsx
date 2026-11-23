import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { colors, layout, radius, shadow, type } from '../../lib/theme';

export type SheetAction = {
  label: string;
  onPress: () => void;
  /** Painted in the destructive colour (Block, Report). */
  destructive?: boolean;
};

type Props = {
  /** Optional heading, e.g. the person's name. */
  title?: string;
  actions: SheetAction[];
  /** Called once the sheet is gone, whether an action was chosen or not. */
  onClose: () => void;
  cancelLabel?: string;
  testID?: string;
};

// If iOS never reports the dismissal, run the chosen action anyway.
const DISMISS_FALLBACK_MS = 600;

/**
 * A bottom sheet of choices, in ConfirmSheet's shell (components/GameForm.tsx).
 *
 * A choice often opens another sheet (Report opens ReportSheet, Block opens a
 * ConfirmSheet). iOS cannot present a new Modal while this one is still
 * animating away, so on iOS the chosen action runs from `onDismiss`, after
 * the sheet has gone. Elsewhere it runs straight away.
 */
export default function ActionSheet({
  title,
  actions,
  onClose,
  cancelLabel = 'Cancel',
  testID = 'action-sheet',
}: Props) {
  const [visible, setVisible] = useState(true);
  const pending = useRef<(() => void) | null>(null);
  const done = useRef(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (fallback.current) clearTimeout(fallback.current);
    },
    [],
  );

  function finish() {
    if (done.current) return;
    done.current = true;
    if (fallback.current) clearTimeout(fallback.current);
    const run = pending.current;
    pending.current = null;
    onClose();
    run?.();
  }

  function choose(run: (() => void) | null) {
    if (done.current || !visible) return;
    pending.current = run;
    if (Platform.OS === 'ios') {
      setVisible(false);
      fallback.current = setTimeout(finish, DISMISS_FALLBACK_MS);
    } else {
      finish();
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => choose(null)}
      onDismiss={Platform.OS === 'ios' ? finish : undefined}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.scrim}
          onPress={() => choose(null)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.sheet} testID={testID}>
          <View style={styles.grabber} />
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {actions.length > 0 ? (
            <View style={styles.list}>
              {actions.map((a, i) => (
                <Pressable
                  key={a.label}
                  onPress={() => choose(a.onPress)}
                  accessibilityRole="button"
                  accessibilityLabel={a.label}
                  style={({ pressed }) => [styles.row, i > 0 && styles.divided, pressed && styles.rowPressed]}
                >
                  <Text style={[styles.rowText, a.destructive && styles.destructive]}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Pressable
            onPress={() => choose(null)}
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
            style={styles.cancel}
          >
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export const sheetStyles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.scrim,
  },
  sheet: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingTop: 10,
    paddingHorizontal: 20,
    paddingBottom: 34,
    gap: 10,
    ...shadow.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.neutral[400],
    marginBottom: 6,
  },
  title: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  cancel: { height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: {
    fontFamily: type.bodyBold,
    fontSize: 15,
    color: colors.neutral[700],
  },
});

const styles = StyleSheet.create({
  ...sheetStyles,
  list: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    overflow: 'hidden',
  },
  row: { minHeight: 50, paddingHorizontal: 16, justifyContent: 'center' },
  rowPressed: { backgroundColor: colors.divider },
  divided: { borderTopWidth: 1, borderTopColor: colors.divider },
  rowText: { fontFamily: type.bodyBold, fontSize: 16, color: colors.text },
  // accent[800] is Profile's "Delete account" colour.
  destructive: { color: colors.accent[800] },
});
