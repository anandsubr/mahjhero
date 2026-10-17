import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../Text';
import { ConfirmSheet } from '../GameForm';
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from '../icons';
import type { ClubMedia } from '../../lib/club-media';
import { MONTHS } from '../../lib/home';
import { colors } from '../../lib/theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "Added by {name} · {Wkd D Mon}", e.g. "Added by Priya Shah · Tue 29 Sept". */
export function mediaCaption(m: Pick<ClubMedia, 'uploaderName' | 'createdAt'>): string {
  const d = new Date(m.createdAt);
  return `Added by ${m.uploaderName} · ${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

type Props = {
  items: { url: string | null; caption: string }[];
  startIndex: number;
  onClose: () => void;
  canRemove: (index: number) => boolean;
  onRemove: (index: number) => void;
  /** Shown in the footer, e.g. a failed Remove; the parent clears it. */
  error?: string | null;
  /** Called when the user moves to the previous or next photo. */
  onNavigate?: () => void;
};

/** Full-screen dark photo viewer with prev/next, a caption and a confirmed Remove. */
export default function MediaViewer({
  items,
  startIndex,
  onClose,
  canRemove,
  onRemove,
  error = null,
  onNavigate,
}: Props) {
  const [index, setIndex] = useState(startIndex);
  const [confirming, setConfirming] = useState(false);
  const { width, height } = useWindowDimensions();
  const safeIndex = Math.min(index, items.length - 1);
  const current = items[safeIndex];
  if (!current) return null;
  const atStart = safeIndex === 0;
  const atEnd = safeIndex === items.length - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.imageArea}>
          {current.url ? (
            <Image source={{ uri: current.url }} style={{ width, height: height * 0.7 }} resizeMode="contain" />
          ) : null}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close image viewer"
          style={styles.close}
        >
          <XIcon size={22} color="#fff" />
        </Pressable>
        {items.length > 1 ? (
          <View style={styles.nav} pointerEvents="box-none">
            <Pressable
              onPress={() => {
                setIndex(Math.max(0, safeIndex - 1));
                onNavigate?.();
              }}
              accessibilityRole="button"
              accessibilityLabel="Previous image"
              disabled={atStart}
              style={[styles.navButton, atStart ? styles.disabled : null]}
            >
              <ChevronLeftIcon size={28} color="#fff" />
            </Pressable>
            <Pressable
              onPress={() => {
                setIndex(Math.min(items.length - 1, safeIndex + 1));
                onNavigate?.();
              }}
              accessibilityRole="button"
              accessibilityLabel="Next image"
              disabled={atEnd}
              style={[styles.navButton, atEnd ? styles.disabled : null]}
            >
              <ChevronRightIcon size={28} color="#fff" />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.footer}>
          <View style={styles.footerText}>
            {error ? (
              <Text testID="media-viewer-error" accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Text style={styles.caption}>{current.caption}</Text>
          </View>
          {canRemove(safeIndex) && !confirming ? (
            <Pressable
              onPress={() => setConfirming(true)}
              accessibilityRole="button"
              accessibilityLabel="Remove"
              style={styles.remove}
            >
              <Text style={styles.removeText}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {confirming ? (
        <ConfirmSheet
          title="Remove this photo?"
          confirmLabel="Remove"
          cancelLabel="Cancel"
          onConfirm={() => {
            setConfirming(false);
            onRemove(safeIndex);
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.92)' },
  imageArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute',
    top: 48,
    right: 12,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nav: {
    position: 'absolute',
    top: 100,
    bottom: 100,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  navButton: { width: 56, height: '100%', alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  footerText: { flex: 1, gap: 4 },
  caption: { color: '#fff', fontSize: 14 },
  error: { color: colors.accent[300], fontSize: 14, fontWeight: '700' },
  remove: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  removeText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
