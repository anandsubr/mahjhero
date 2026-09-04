// components/messages/AttachmentGrid.tsx
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { getSignedUrls } from '../../lib/attachments';
import type { MessageAttachment } from '../../lib/messages';
import { colors, radius, space } from '../../lib/theme';

type Props = { attachments: MessageAttachment[] };

/**
 * 1-4 images as a grid: one full width, two side by side, three or four as
 * a 2x2 (a lone third slot spans the remaining width rather than leaving a
 * gap). Sized from the stored width/height so the bubble doesn't reflow
 * once the signed URL resolves and the real image loads.
 */
export default function AttachmentGrid({ attachments }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    if (attachments.length === 0) return;
    let cancelled = false;
    void getSignedUrls(attachments.map((a) => a.storage_path)).then((resolved) => {
      if (!cancelled) setUrls(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [attachments]);

  if (attachments.length === 0) return null;

  return (
    <View style={styles.grid} testID="attachment-grid">
      {attachments.map((a, index) => (
        <Pressable
          key={a.id}
          onPress={() => setViewerIndex(index)}
          accessibilityRole="button"
          accessibilityLabel={`View image ${index + 1} of ${attachments.length}`}
          style={[
            styles.cell,
            attachments.length === 1 ? styles.cellSingle : styles.cellGrid,
            { aspectRatio: attachments.length === 1 ? a.width / a.height : 1 },
          ]}
        >
          {urls[a.storage_path] ? (
            <Image source={{ uri: urls[a.storage_path] }} style={styles.image} />
          ) : (
            <View style={styles.placeholder} />
          )}
        </Pressable>
      ))}

      {viewerIndex !== null ? (
        <AttachmentViewer
          attachments={attachments}
          urls={urls}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
}

function AttachmentViewer({
  attachments,
  urls,
  startIndex,
  onClose,
}: {
  attachments: MessageAttachment[];
  urls: Record<string, string>;
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const { width, height } = useWindowDimensions();
  const current = attachments[index];
  const atStart = index === 0;
  const atEnd = index === attachments.length - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={styles.viewerBackdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close image viewer"
      >
        {urls[current.storage_path] ? (
          <Image
            source={{ uri: urls[current.storage_path] }}
            style={{ width, height: height * 0.8 }}
            resizeMode="contain"
          />
        ) : null}
      </Pressable>
      {attachments.length > 1 ? (
        <View style={styles.viewerNav} pointerEvents="box-none">
          <Pressable
            onPress={() => setIndex((i) => Math.max(0, i - 1))}
            accessibilityRole="button"
            accessibilityLabel="Previous image"
            disabled={atStart}
            // Same "render the icon, dim the button" disabled convention
            // AttachmentPicker.tsx's attach button uses (attachButtonDisabled,
            // opacity 0.4), rather than swapping the icon out for nothing.
            style={[styles.viewerNavButton, atStart ? styles.viewerNavButtonDisabled : null]}
          >
            <ChevronLeftIcon size={28} color={colors.bg} />
          </Pressable>
          <Pressable
            onPress={() => setIndex((i) => Math.min(attachments.length - 1, i + 1))}
            accessibilityRole="button"
            accessibilityLabel="Next image"
            disabled={atEnd}
            style={[styles.viewerNavButton, atEnd ? styles.viewerNavButtonDisabled : null]}
          >
            <ChevronRightIcon size={28} color={colors.bg} />
          </Pressable>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], marginBottom: space[2] },
  cell: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: 'transparent' },
  cellSingle: { width: '100%' },
  cellGrid: { width: '48%' },
  image: { width: '100%', height: '100%' },
  placeholder: { width: '100%', height: '100%', backgroundColor: 'rgba(32, 30, 29, 0.08)' },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNav: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  viewerNavButton: {
    width: 64,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNavButtonDisabled: { opacity: 0.4 },
});
