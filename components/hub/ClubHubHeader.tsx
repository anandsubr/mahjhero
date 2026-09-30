import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ImageBackground, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../Text';
import { ChevronLeftIcon, SettingsIcon, ShareIcon } from '../icons';
import SectionButtons from './SectionButtons';
import { coverColorValue, shareClubCode, type HubSection } from '../../lib/club-hub';
import type { Club } from '../../lib/clubs';
import { colors, layout, radius, type } from '../../lib/theme';

/** `#rrggbb` → `rgba(r, g, b, alpha)`, so the scrim derives from the token. */
function withAlpha(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const SCRIM = withAlpha(colors.neutral[900], 0.55);
const WHITE_16 = 'rgba(255, 255, 255, 0.16)';
const WHITE_26 = 'rgba(255, 255, 255, 0.26)';
const COPIED_MS = 2000;

/**
 * The club hub's fixed header (design 1b–1e): cover photo under a 55%
 * `neutral[900]` scrim, or the club's cover colour; back, name and the
 * organizer-only settings gear; the club code with a Share pill; and the
 * five section buttons. Owns the top safe-area inset -- the sections below
 * it (HubSection) deliberately add none.
 */
export default function ClubHubHeader({
  club,
  coverUrl,
  canManage,
  active,
  onBack,
  onSettings,
  onSelect,
}: {
  club: Club;
  coverUrl: string | null;
  canManage: boolean;
  active: HubSection;
  onBack: () => void;
  onSettings: () => void;
  onSelect: (s: HubSection) => void;
}) {
  const insets = useSafeAreaInsets();
  const [photoFailed, setPhotoFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  // A new cover URL (replaced photo, re-signed URL) gets a fresh attempt.
  useEffect(() => {
    setPhotoFailed(false);
  }, [coverUrl]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  async function onShare() {
    const result = await shareClubCode(club.name, club.code);
    if (!mounted.current || result !== 'copied') return;
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    setCopied(true);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      setCopied(false);
    }, COPIED_MS);
  }

  const background = coverColorValue(club.cover_color);
  const content = (
    <View style={[styles.column, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          onPress={onBack}
          style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
        >
          <ChevronLeftIcon size={24} color="#fff" />
        </Pressable>
        <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
          {club.name}
        </Text>
        {canManage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Club settings"
            onPress={onSettings}
            style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
          >
            <SettingsIcon size={22} color="#fff" />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.codeRow}>
        <Text style={styles.code} numberOfLines={1}>{`Club code: ${club.code}`}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Share club code"
          onPress={onShare}
          // The pill is drawn 32pt tall; the slop brings the target to 44pt.
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
          style={({ pressed }) => [styles.share, pressed && styles.sharePressed]}
        >
          <ShareIcon size={14} color="#fff" />
          <Text style={styles.shareLabel}>{copied ? 'Copied' : 'Share'}</Text>
        </Pressable>
      </View>
      <SectionButtons active={active} onSelect={onSelect} />
    </View>
  );

  if (coverUrl && !photoFailed) {
    return (
      <HeaderPhoto uri={coverUrl} background={background} onError={() => setPhotoFailed(true)}>
        {content}
      </HeaderPhoto>
    );
  }

  return (
    <View testID="club-hub-header" style={[styles.header, { backgroundColor: background }]}>
      {content}
    </View>
  );
}

function HeaderPhoto({
  uri,
  background,
  onError,
  children,
}: {
  uri: string;
  background: string;
  onError: () => void;
  children: ReactNode;
}) {
  return (
    <ImageBackground
      testID="club-hub-cover-photo"
      source={{ uri }}
      resizeMode="cover"
      onError={onError}
      // The colour shows while the photo loads.
      style={[styles.header, { backgroundColor: background }]}
    >
      <View testID="club-hub-scrim" pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM }]} />
      {children}
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  header: { width: '100%', overflow: 'hidden' },
  column: { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: { backgroundColor: WHITE_16 },
  name: {
    flex: 1,
    minWidth: 0,
    fontFamily: type.heading,
    fontSize: 26,
    lineHeight: 30,
    color: '#fff',
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 52,
    paddingRight: 16,
  },
  code: { flexShrink: 1, fontFamily: type.bodySemiBold, fontSize: 14, color: '#fff' },
  share: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: WHITE_16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sharePressed: { backgroundColor: WHITE_26 },
  shareLabel: { fontFamily: type.bodyBold, fontSize: 13, color: '#fff' },
});
