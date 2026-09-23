import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Button from './Button';
import { CopyIcon } from './icons';
import { detectInAppBrowserLabel } from '../lib/in-app-browser';
import { colors, radius, space, type } from '../lib/theme';

/**
 * Some email and social apps open sign-in and invite links in their own
 * restricted WebView instead of the device's real browser -- Yahoo Mail's
 * was confirmed, by hand, to have no editable address bar and no "open in
 * Safari" option in its menu, which breaks this app's own "paste this link
 * into your browser" fallback text in the sign-in email. Nothing server- or
 * app-side can force a hand-off those apps don't offer, so this only ever
 * surfaces a way out: copy the current URL so it can be pasted into a real
 * browser by hand.
 */
export default function InAppBrowserBanner() {
  const [label, setLabel] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    setLabel(detectInAppBrowserLabel(navigator.userAgent));
  }, []);

  if (Platform.OS !== 'web' || !label || dismissed) return null;

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch (cause) {
      console.error('copy current link failed', cause);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View accessibilityRole="alert" style={styles.container}>
      <View style={styles.row}>
        <View style={styles.dot} />
        <Text style={styles.text}>
          You're viewing this inside {label}, which can block sign-in links
          from working properly. Copy this link and open it in Safari or
          Chrome instead.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          big={false}
          onPress={onCopy}
          icon={<CopyIcon size={16} color={colors.accentColor} />}
        >
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
        <Button
          variant="ghost"
          big={false}
          onPress={() => setDismissed(true)}
          accessibilityLabel="Dismiss"
        >
          Dismiss
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.accent[200],
    borderRadius: radius.card,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    margin: space[3],
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: colors.accent[700],
    marginTop: 8,
  },
  text: {
    flex: 1,
    fontFamily: type.bodyRegular,
    fontSize: type.size.body,
    lineHeight: 24,
    color: colors.accent[800],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space[2],
  },
});
