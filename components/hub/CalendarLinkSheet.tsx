import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { CopyIcon, ShareIcon, XIcon } from '../icons';
import { colors, layout, radius, shadow, type } from '../../lib/theme';

const COPIED_MS = 2000;

/**
 * The calendar-subscription link, for when `webcal://` cannot be opened
 * directly: always on web, and on native when no app claims the scheme.
 * Shows the https link as selectable text (so it can still be copied by hand
 * when the clipboard API is missing or refused), a Copy link button on web
 * or a Share link button on native, and where to paste it.
 */
export default function CalendarLinkSheet({
  visible,
  url,
  onClose,
}: {
  visible: boolean;
  url: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const web = Platform.OS === 'web';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // A reopened sheet starts from "Copy link" again.
  useEffect(() => {
    if (!visible) setCopied(false);
  }, [visible]);

  async function onAction() {
    try {
      if (web) {
        // `navigator.clipboard` is absent on insecure origins and some
        // in-app browsers; the throw lands below and the link stays on
        // screen, selectable, for a manual copy.
        await navigator.clipboard.writeText(url);
        if (!mounted.current) return;
        if (timer.current) clearTimeout(timer.current);
        setCopied(true);
        timer.current = setTimeout(() => {
          timer.current = null;
          setCopied(false);
        }, COPIED_MS);
      } else {
        await Share.share({ message: url });
      }
    } catch (cause) {
      console.error('CalendarLinkSheet action failed', cause);
    }
  }

  const label = web ? 'Copy link' : 'Share link';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Hidden from assistive tech: the ✕ is the one announced Close. */}
        <Pressable
          style={styles.scrim}
          onPress={onClose}
          testID="calendar-link-scrim"
          accessible={false}
          focusable={false}
          aria-hidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={styles.sheet} testID="calendar-link-sheet">
          <View style={styles.headRow}>
            <Text accessibilityRole="header" style={styles.heading}>Add to calendar</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={4}
              style={styles.close}
            >
              <XIcon size={18} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.urlBox}>
            <Text selectable style={styles.url}>{url}</Text>
          </View>
          <Pressable
            onPress={() => void onAction()}
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : label}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          >
            {web ? <CopyIcon size={18} color="#fff" /> : <ShareIcon size={18} color="#fff" />}
            <Text style={styles.actionText}>{copied ? 'Copied' : label}</Text>
          </Pressable>
          <Text style={styles.hint}>Add it in your calendar app under ‘Subscribe to calendar’.</Text>
        </View>
      </View>
    </Modal>
  );
}

// Shell copied from BringSomeoneSheet so the app's bottom sheets match.
const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    // neutral-900 at 40%.
    backgroundColor: 'rgba(46, 43, 37, 0.4)',
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
    gap: 12,
    ...shadow.lg,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontFamily: type.bodyBold, fontSize: 17, color: colors.text },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  urlBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  url: { fontFamily: type.bodyRegular, fontSize: 14, color: colors.text },
  action: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionPressed: { backgroundColor: colors.accent[800] },
  actionText: { fontFamily: type.bodyBold, fontSize: 16, color: '#fff' },
  hint: { fontFamily: type.bodyRegular, fontSize: 14, color: colors.textMuted },
});
