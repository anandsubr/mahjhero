import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Text } from '../../../../components/Text';
import Button from '../../../../components/Button';
import HubSection from '../../../../components/hub/HubSection';
import { useClubHub } from '../../../../components/hub/ClubHubContext';
import { PlusIcon } from '../../../../components/icons';
import PhotoGrid from '../../../../components/media/PhotoGrid';
import MediaViewer, { mediaCaption } from '../../../../components/media/MediaViewer';
import FileRow from '../../../../components/media/FileRow';
import {
  fetchClubMedia,
  getMediaUrls,
  pickClubFile,
  removeClubMedia,
  uploadClubFile,
  uploadClubPhotos,
  MAX_PHOTOS_PER_BATCH,
  type ClubMedia,
} from '../../../../lib/club-media';
import { pickImages } from '../../../../lib/attachments';
import { canInvite } from '../../../../lib/clubs';
import { GENERIC_ERROR } from '../../../../lib/constants';
import { useSession } from '../../../../lib/session';
import { colors, radius, type } from '../../../../lib/theme';

type Kind = 'photo' | 'file';

const SEGMENTS: { key: Kind; label: string }[] = [
  { key: 'photo', label: 'Photos' },
  { key: 'file', label: 'Files' },
];

const PAGE = 60;

/**
 * The club hub's Photos section: a Photos / Files segmented control with an
 * upload button, a 3-column photo grid (with a full-screen viewer) or a file
 * list, newest first, 60 at a time.
 */
export default function PhotosSection() {
  const { club, role } = useClubHub();
  const { session } = useSession();
  const me = session?.user.id ?? null;
  const isOrganizer = role !== null && canInvite(role);

  const [kind, setKind] = useState<Kind>('photo');
  const [items, setItems] = useState<ClubMedia[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // Errors for the photo viewer, which covers the section's own error lines.
  const [viewerError, setViewerError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  // A ref as well as state: two taps in one frame both see stale state.
  const uploadInFlight = useRef(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // How many items are on screen, read by `load` without becoming one of its
  // dependencies (which would refire the focus effect after every page).
  const loadedCount = useRef(0);
  const itemsRef = useRef<ClubMedia[] | null>(null);
  function showItems(next: ClubMedia[]) {
    itemsRef.current = next;
    loadedCount.current = next.length;
    setItems(next);
  }

  const fetchUrls = useCallback(async (list: ClubMedia[]) => {
    if (list.length === 0) return;
    const signed = await getMediaUrls(list.map((m) => m.storagePath));
    if (mounted.current) setUrls((prev) => ({ ...prev, ...signed }));
  }, []);

  // Only the newest read may write state: a tab switch, a refocus, a refresh
  // and "Show more" can overlap, and an older read resolving last would put
  // the wrong tab's (or a stale page's) items on screen.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    // Reload everything already on screen (at least a page), so a refresh
    // after "Show more" never collapses the list back to its first page.
    const limit = Math.max(loadedCount.current, PAGE);
    const result = await fetchClubMedia(club.id, kind, undefined, limit);
    if (seq !== loadSeq.current || !mounted.current) return;
    setFailed(result === null);
    if (result === null) return; // keep whatever is on screen
    showItems(result);
    setHasMore(result.length === limit);
    if (kind === 'photo') void fetchUrls(result);
  }, [club.id, kind, fetchUrls]);

  const loadRef = useRef(load);
  loadRef.current = load;

  // Runs on focus and whenever `load` changes (a new tab).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function showMore() {
    const current = itemsRef.current;
    if (loadingMore || !current || current.length === 0) return;
    const seq = loadSeq.current;
    setLoadingMore(true);
    const result = await fetchClubMedia(club.id, kind, current[current.length - 1].createdAt, PAGE);
    if (!mounted.current) return;
    setLoadingMore(false);
    // A newer load replaced the list meanwhile; this page no longer follows it.
    if (seq !== loadSeq.current || itemsRef.current !== current) return;
    if (result === null) {
      setFailed(true);
      return;
    }
    showItems([...current, ...result]);
    setHasMore(result.length === PAGE);
    if (kind === 'photo') void fetchUrls(result);
  }

  function selectKind(next: Kind) {
    if (next === kind) return;
    // The previous tab's items would be wrong under the new label.
    loadSeq.current += 1;
    itemsRef.current = null;
    loadedCount.current = 0;
    setItems(null);
    setHasMore(false);
    setFailed(false);
    setLoadingMore(false);
    setViewerIndex(null);
    setViewerError(null);
    setErrors([]);
    setKind(next);
  }

  async function upload() {
    if (uploadInFlight.current) return;
    uploadInFlight.current = true;
    setUploading(true);
    setErrors([]);
    try {
      if (kind === 'photo') {
        const picked = await pickImages('library', 0, MAX_PHOTOS_PER_BATCH);
        if (!picked || picked.length === 0) return;
        if (mounted.current) setProgress({ current: 1, total: picked.length });
        const { added, errors: failures } = await uploadClubPhotos(club.id, picked, (done, total) => {
          if (mounted.current) setProgress({ current: Math.min(done + 1, total), total });
        });
        if (!mounted.current) return;
        setProgress(null);
        setErrors([...new Set(failures)]);
        if (added > 0) await loadRef.current();
      } else {
        const file = await pickClubFile();
        if (!file) return;
        const { error } = await uploadClubFile(club.id, file);
        if (!mounted.current) return;
        if (error) setErrors([error]);
        else await loadRef.current();
      }
    } finally {
      uploadInFlight.current = false;
      if (mounted.current) {
        setUploading(false);
        setProgress(null);
      }
    }
  }

  const canRemove = (item: ClubMedia) => item.uploadedBy === me || isOrganizer;

  async function remove(item: ClubMedia, fromViewer = false) {
    setErrors([]);
    setViewerError(null);
    const { error } = await removeClubMedia(item);
    if (!mounted.current) return;
    if (error) {
      if (fromViewer) setViewerError(error);
      else setErrors([error]);
      return;
    }
    // A reload that started before the delete would bring the item back.
    loadSeq.current += 1;
    const current = itemsRef.current;
    if (!current) return;
    const next = current.filter((m) => m.id !== item.id);
    showItems(next);
    if (kind === 'photo' && next.length === 0) setViewerIndex(null);
  }

  async function openFile(item: ClubMedia) {
    setErrors([]);
    // Browsers block a new tab opened after an await, so open it now and
    // point it at the signed link once it arrives.
    const tab = Platform.OS === 'web' ? window.open('', '_blank') : null;
    const signed = await getMediaUrls([item.storagePath]);
    const url = signed[item.storagePath];
    if (!url) {
      tab?.close();
      if (mounted.current) setErrors([GENERIC_ERROR]);
      return;
    }
    if (Platform.OS === 'web') {
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener');
      }
      return;
    }
    try {
      await Linking.openURL(url);
    } catch (cause) {
      console.error('open club file failed', cause);
      if (mounted.current) setErrors([GENERIC_ERROR]);
    }
  }

  const addLabel = kind === 'photo' ? 'Add photos' : 'Add a file';
  const photosList = kind === 'photo' && items ? items : [];

  return (
    <>
      <HubSection onRefresh={load}>
        <View style={styles.topRow}>
          <View style={styles.track} accessibilityRole="tablist">
            {SEGMENTS.map((s) => {
              const selected = s.key === kind;
              return (
                <Pressable
                  key={s.key}
                  accessibilityRole="tab"
                  accessibilityLabel={s.label}
                  accessibilityState={{ selected }}
                  aria-selected={selected}
                  onPress={() => selectKind(s.key)}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={addLabel}
            accessibilityState={{ disabled: uploading, busy: uploading }}
            aria-disabled={uploading}
            disabled={uploading}
            onPress={() => void upload()}
            style={({ pressed }) => [
              styles.add,
              pressed && styles.addPressed,
              uploading && styles.addDisabled,
            ]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <PlusIcon size={22} color="#fff" />
            )}
          </Pressable>
        </View>

        {progress ? (
          <View style={styles.progress} accessibilityLiveRegion="polite">
            <ActivityIndicator size="small" color={colors.accentColor} />
            <Text style={styles.progressText}>
              {`Uploading ${progress.current} of ${progress.total}…`}
            </Text>
          </View>
        ) : null}

        {errors.map((e) => (
          <Text key={e} accessibilityRole="alert" style={styles.error}>
            {e}
          </Text>
        ))}

        {failed ? (
          <View accessibilityRole="alert" style={styles.failed}>
            <Text style={styles.failedText}>
              {kind === 'photo' ? 'Could not load photos.' : 'Could not load files.'}
            </Text>
            <Button variant="secondary" big={false} accessibilityLabel="Retry" onPress={() => void load()}>
              Retry
            </Button>
          </View>
        ) : null}

        {items === null ? (
          failed ? null : (
            <ActivityIndicator style={styles.loading} color={colors.accentColor} />
          )
        ) : items.length === 0 ? (
          failed ? null : (
            <Text style={styles.emptyText}>
              {kind === 'photo'
                ? 'No photos yet. Tap + to add the first one.'
                : 'No files yet. Tap + to add one.'}
            </Text>
          )
        ) : kind === 'photo' ? (
          <PhotoGrid
            photos={items}
            urls={urls}
            onOpen={(i) => {
              setViewerError(null);
              setViewerIndex(i);
            }}
          />
        ) : (
          <View style={styles.files}>
            {items.map((f) => (
              <View key={f.id} style={styles.fileCard}>
                <FileRow
                  file={f}
                  onOpen={() => void openFile(f)}
                  canRemove={canRemove(f)}
                  onRemove={() => void remove(f)}
                />
              </View>
            ))}
          </View>
        )}

        {items && items.length > 0 && hasMore ? (
          <View style={styles.more}>
            <Button
              variant="secondary"
              big={false}
              accessibilityLabel="Show more"
              loading={loadingMore}
              onPress={() => void showMore()}
            >
              Show more
            </Button>
          </View>
        ) : null}
      </HubSection>
      {viewerIndex !== null && photosList.length > 0 ? (
        <MediaViewer
          items={photosList.map((p) => ({ url: urls[p.storagePath] ?? null, caption: mediaCaption(p) }))}
          startIndex={viewerIndex}
          onClose={() => {
            setViewerError(null);
            setViewerIndex(null);
          }}
          error={viewerError}
          onNavigate={() => setViewerError(null)}
          canRemove={(i) => (photosList[i] ? canRemove(photosList[i]) : false)}
          onRemove={(i) => {
            const p = photosList[i];
            if (p) void remove(p, true);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  // The Games section's segmented pill.
  track: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 3,
  },
  option: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionSelected: { backgroundColor: colors.accent[700] },
  optionLabel: { fontFamily: type.bodyBold, fontSize: 14, color: colors.text },
  optionLabelSelected: { color: '#fff' },
  add: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accent[700],
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPressed: { backgroundColor: colors.accent[800] },
  addDisabled: { opacity: 0.6 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  progressText: { fontFamily: type.bodySemiBold, fontSize: 14, color: colors.text },
  error: {
    fontFamily: type.bodySemiBold,
    fontSize: 14,
    color: colors.accent[800],
    marginBottom: 12,
  },
  loading: { marginTop: 24 },
  emptyText: {
    fontFamily: type.bodyRegular,
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 32,
  },
  failed: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  failedText: { fontFamily: type.bodyRegular, fontSize: 16, color: colors.text },
  files: { gap: 8 },
  // The design's surface card rows.
  fileCard: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 1 },
  more: { alignItems: 'center', marginTop: 16 },
});
