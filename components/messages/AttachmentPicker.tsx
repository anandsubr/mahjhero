// components/messages/AttachmentPicker.tsx
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { PlusIcon, TrashIcon } from '../icons';
import {
  compressImage,
  pickImages,
  uploadAttachment,
  MAX_ATTACHMENTS,
  type PickedImage,
} from '../../lib/attachments';
import type { MessageAttachmentInput } from '../../lib/messages';
import { colors, radius, space, type } from '../../lib/theme';

type Item = {
  localId: string;
  uri: string;
  width: number;
  height: number;
  storagePath: string | null;
  status: 'uploading' | 'done' | 'error';
};

type Props = {
  threadId: string;
  onAttachmentsChange: (ready: MessageAttachmentInput[], pending: boolean) => void;
};

let nextLocalId = 0;

/**
 * Attach button + action-sheet + thumbnail strip, all in one self-contained
 * component -- the same "owns everything about" pattern MembersPanel.tsx
 * already establishes for Add people/leaving (per Composer.tsx's own
 * docstring). This component owns its own upload-progress state (picking ->
 * compressing -> uploading -> done/error, per image) and only reports the
 * finished, ready-to-send attachment list upward via `onAttachmentsChange`.
 *
 * `key`-remountable, not imperatively resettable: the caller bumps this
 * component's `key` prop to reset it after a successful send, the same
 * reset shape a controlled form input would need.
 */
export default function AttachmentPicker({ threadId, onAttachmentsChange }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);

  // Reports upward whenever the item list changes -- the caller derives
  // Send's disabled state from `pending` and the final payload from `ready`.
  // A ref, not a dependency on `onAttachmentsChange` itself: the callers
  // below pass an inline closure, and re-running this effect on every
  // parent render (rather than only when `items` actually changes) would
  // fire it far more than the caller's own state actually changed.
  const onChangeRef = useRef(onAttachmentsChange);
  onChangeRef.current = onAttachmentsChange;
  useEffect(() => {
    const ready = items
      .filter((i): i is Item & { storagePath: string } => i.status === 'done' && i.storagePath !== null)
      .map((i) => ({ storage_path: i.storagePath, width: i.width, height: i.height }));
    const pending = items.some((i) => i.status === 'uploading');
    onChangeRef.current(ready, pending);
  }, [items]);

  async function addPicked(picked: PickedImage[]) {
    const pending: Item[] = picked.map((p) => ({
      localId: `a${nextLocalId++}`,
      uri: p.uri,
      width: p.width,
      height: p.height,
      storagePath: null,
      status: 'uploading',
    }));
    setItems((prev) => [...prev, ...pending]);

    for (const [index, picture] of picked.entries()) {
      const localId = pending[index].localId;
      try {
        const compressed = await compressImage(picture);
        const { storagePath, error } = await uploadAttachment(threadId, compressed);
        setItems((prev) =>
          prev.map((i) =>
            i.localId === localId
              ? {
                  ...i,
                  width: compressed.width,
                  height: compressed.height,
                  storagePath,
                  status: error || !storagePath ? 'error' : 'done',
                }
              : i,
          ),
        );
      } catch (cause) {
        console.error('attachment upload failed', cause);
        setItems((prev) =>
          prev.map((i) => (i.localId === localId ? { ...i, status: 'error' } : i)),
        );
      }
    }
  }

  async function choose(source: 'camera' | 'library') {
    setSourceMenuOpen(false);
    const picked = await pickImages(source, items.length);
    if (picked && picked.length > 0) void addPicked(picked);
  }

  function remove(localId: string) {
    setItems((prev) => prev.filter((i) => i.localId !== localId));
  }

  const atLimit = items.length >= MAX_ATTACHMENTS;

  return (
    <View style={styles.container}>
      {items.length > 0 ? (
        <View style={styles.strip} testID="attachment-strip">
          {items.map((item) => (
            <View key={item.localId} style={styles.thumbWrap}>
              <Image source={{ uri: item.uri }} style={styles.thumb} />
              {item.status === 'uploading' ? (
                <View style={styles.overlay}>
                  <Text style={styles.overlayText}>…</Text>
                </View>
              ) : null}
              {item.status === 'error' ? (
                <View style={[styles.overlay, styles.overlayError]}>
                  <Text style={styles.overlayText}>!</Text>
                </View>
              ) : null}
              <Pressable
                onPress={() => remove(item.localId)}
                accessibilityRole="button"
                accessibilityLabel="Remove image"
                style={styles.removeButton}
              >
                <TrashIcon size={14} color={colors.bg} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={() => setSourceMenuOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Attach an image"
        disabled={atLimit}
        style={[styles.attachButton, atLimit ? styles.attachButtonDisabled : null]}
      >
        <PlusIcon size={18} color={colors.text} />
      </Pressable>

      {/*
        A hand-rolled action sheet, not Alert.alert: react-native-web's
        Alert has no real UI (it degrades to a no-op or a bare confirm()),
        and this app targets web as a first-class platform. Modal is the
        same primitive RoundTimer.tsx already uses for an overlay.
      */}
      <Modal
        visible={sourceMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSourceMenuOpen(false)}
      >
        {/*
          No accessibilityRole/accessibilityLabel here, deliberately: giving
          this Pressable `accessibilityRole="button"` (as the brief's own
          draft did) makes react-native-web render it as a real `<button>`,
          and the two sheet options below are ALSO real buttons nested
          inside it -- invalid HTML ("<button> cannot be a descendant of
          <button>", confirmed live from the jsdom console warning this
          produced) with unreliable click-bubbling and accessibility
          semantics in a real browser, not just a test artifact. This stays
          a plain tap-to-dismiss surface: Escape/Android-back dismissal is
          already covered by the Modal's own `onRequestClose` below, and the
          two real option buttons remain independently reachable and
          labeled.
        */}
        <Pressable style={styles.sheetBackdrop} onPress={() => setSourceMenuOpen(false)}>
          <View style={styles.sheet}>
            {/* Camera capture has no reliable web equivalent -- library only there. */}
            {Platform.OS !== 'web' ? (
              <Pressable
                onPress={() => void choose('camera')}
                accessibilityRole="button"
                style={styles.sheetOption}
              >
                <Text style={styles.sheetOptionText}>Take a photo</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => void choose('library')}
              accessibilityRole="button"
              style={styles.sheetOption}
            >
              <Text style={styles.sheetOptionText}>Choose from library</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space[2] },
  strip: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap' },
  thumbWrap: { width: 64, height: 64, borderRadius: radius.md, overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(32, 30, 29, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayError: { backgroundColor: 'rgba(140, 73, 26, 0.65)' },
  overlayText: { color: colors.bg, fontFamily: type.bodyBold, fontSize: type.size.body },
  removeButton: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  attachButtonDisabled: { opacity: 0.4 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(32, 30, 29, 0.3)',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingVertical: space[4],
    paddingHorizontal: space[4],
    gap: space[2],
  },
  sheetOption: { paddingVertical: space[3] },
  sheetOptionText: {
    fontFamily: type.bodySemiBold,
    fontSize: type.size.body,
    color: colors.text,
  },
});
