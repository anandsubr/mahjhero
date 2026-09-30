import { Platform, Share } from 'react-native';
import { colors } from './theme';

/**
 * The five palette tokens a host can pick as a club's cover colour (used
 * when there is no cover photo). Values are pre-resolved from `lib/theme`
 * so this module — and every screen that renders a swatch — never repeats
 * a hex literal. White header text stays readable on all five.
 */
export type CoverColor =
  | 'accent2_800'
  | 'accent2_700'
  | 'accent_700'
  | 'accent_800'
  | 'neutral_800';

export const COVER_COLORS: { key: CoverColor; label: string; value: string }[] = [
  { key: 'accent2_800', label: 'Dark green', value: colors.accent2[800] },
  { key: 'accent2_700', label: 'Olive', value: colors.accent2[700] },
  { key: 'accent_700', label: 'Clay', value: colors.accent[700] },
  { key: 'accent_800', label: 'Dark brown', value: colors.accent[800] },
  { key: 'neutral_800', label: 'Charcoal', value: colors.neutral[800] },
];

/** Resolves a cover-colour key to its hex value. An unknown key is dark green, same as the DB default. */
export function coverColorValue(key: string): string {
  return COVER_COLORS.find((c) => c.key === key)?.value ?? COVER_COLORS[0].value;
}

export type HubSection = 'board' | 'games' | 'photos' | 'members' | 'ranks';

export const HUB_SECTIONS: { key: HubSection; label: string }[] = [
  { key: 'board', label: 'Board' },
  { key: 'games', label: 'Games' },
  { key: 'photos', label: 'Photos' },
  { key: 'members', label: 'Members' },
  { key: 'ranks', label: 'Ranks' },
];

export function shareText(clubName: string, code: string): string {
  return `Join ${clubName} on MahjHero with code ${code}`;
}

/**
 * Shares a club's join code. Web has no native share sheet worth using for
 * plain text, so it copies to the clipboard instead; native platforms use
 * the system Share sheet. Never throws — a failure (permission denial,
 * clipboard unavailable) is reported as `'failed'` so the caller can show
 * its own message rather than an uncaught rejection.
 */
export async function shareClubCode(
  clubName: string,
  code: string,
): Promise<'shared' | 'copied' | 'failed'> {
  const message = shareText(clubName, code);
  try {
    if (Platform.OS === 'web') {
      await navigator.clipboard.writeText(message);
      return 'copied';
    }
    await Share.share({ message });
    return 'shared';
  } catch (cause) {
    console.error('shareClubCode failed', cause);
    return 'failed';
  }
}
