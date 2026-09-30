import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../Text';
import { ChevronLeftIcon, SettingsIcon, ShareIcon } from '../icons';
import ClubCover from './ClubCover';
import SectionButtons from './SectionButtons';
import { shareClubCode, type HubSection } from '../../lib/club-hub';
import type { Club } from '../../lib/clubs';
import { layout, radius, type } from '../../lib/theme';

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
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

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

  return (
    <ClubCover
      coverUrl={coverUrl}
      coverColor={club.cover_color}
      style={styles.header}
      testID="club-hub-header"
      testIDPrefix="club-hub"
    >
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
        <View style={styles.codeRow} testID="club-hub-code-row">
          <Text style={styles.code} numberOfLines={1}>{`Club code: ${club.code}`}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share club code"
            onPress={onShare}
            // A 44pt target with the 32pt pill drawn inside it: hitSlop is
            // not honoured on react-native-web.
            style={styles.shareTarget}
          >
            {({ pressed }) => (
              <View style={[styles.share, pressed && styles.sharePressed]}>
                <ShareIcon size={14} color="#fff" />
                <Text
                  style={styles.shareLabel}
                  accessibilityLiveRegion="polite"
                  aria-live="polite"
                >
                  {copied ? 'Copied' : 'Share'}
                </Text>
              </View>
            )}
          </Pressable>
        </View>
        <SectionButtons active={active} onSelect={onSelect} />
      </View>
    </ClubCover>
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
  shareTarget: { minHeight: 44, justifyContent: 'center' },
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
