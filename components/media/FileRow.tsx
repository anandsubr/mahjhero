import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../Text';
import { ConfirmSheet } from '../GameForm';
import { DownloadIcon, FileIcon, MoreHorizontalIcon } from '../icons';
import { fileTypeLabel, formatBytes, type ClubMedia } from '../../lib/club-media';
import { colors } from '../../lib/theme';

type Props = {
  file: ClubMedia;
  /** Download / open the file. */
  onOpen: () => void;
  /** Uploader, or a host / co-organizer. */
  canRemove: boolean;
  onRemove: () => void;
};

export default function FileRow({ file, onOpen, canRemove, onRemove }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const type = fileTypeLabel(file.fileName);

  return (
    <View>
      <View style={styles.row}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Open ${file.fileName}`}
          style={styles.main}
        >
          <View style={styles.tile}>
            <FileIcon size={20} color={colors.accent[700]} />
            <Text style={styles.tileLabel}>{type}</Text>
          </View>
          <View style={styles.texts}>
            <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
              {file.fileName}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {`${type} · ${formatBytes(file.sizeBytes)} · ${file.uploaderName}`}
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Download ${file.fileName}`}
          style={styles.iconButton}
        >
          <DownloadIcon size={20} color={colors.neutral[700]} />
        </Pressable>
        {canRemove ? (
          <Pressable
            onPress={() => setMenuOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel="More options"
            accessibilityState={{ expanded: menuOpen }}
            style={styles.iconButton}
          >
            <MoreHorizontalIcon size={20} color={colors.neutral[700]} />
          </Pressable>
        ) : null}
      </View>
      {menuOpen && !confirming ? (
        <Pressable
          onPress={() => setConfirming(true)}
          accessibilityRole="button"
          accessibilityLabel="Remove"
          style={styles.menuItem}
        >
          <Text style={styles.menuText}>Remove</Text>
        </Pressable>
      ) : null}
      {confirming ? (
        <ConfirmSheet
          title="Remove this file?"
          confirmLabel="Remove"
          cancelLabel="Cancel"
          onConfirm={() => {
            setConfirming(false);
            setMenuOpen(false);
            onRemove();
          }}
          onCancel={() => setConfirming(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: 4 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, minWidth: 0 },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.accent[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { fontSize: 9, fontWeight: '800', color: colors.accent[700], marginTop: 1 },
  texts: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  menuItem: {
    alignSelf: 'flex-end',
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  menuText: { fontSize: 15, fontWeight: '700', color: colors.accent[700] },
});
