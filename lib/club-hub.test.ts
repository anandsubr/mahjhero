import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let platformOS = 'web';
vi.mock('react-native', () => ({
  Platform: { get OS() { return platformOS; } },
  Share: { share: vi.fn() },
}));

import { Share } from 'react-native';
import {
  COVER_COLORS,
  coverColorValue,
  HUB_SECTIONS,
  shareClubCode,
  shareText,
} from './club-hub';
import { colors } from './theme';

describe('COVER_COLORS', () => {
  it('lists the five tokens in order with labels and values', () => {
    expect(COVER_COLORS).toEqual([
      { key: 'accent2_800', label: 'Dark green', value: colors.accent2[800] },
      { key: 'accent2_700', label: 'Olive', value: colors.accent2[700] },
      { key: 'accent_700', label: 'Clay', value: colors.accent[700] },
      { key: 'accent_800', label: 'Dark brown', value: colors.accent[800] },
      { key: 'neutral_800', label: 'Charcoal', value: colors.neutral[800] },
    ]);
  });
});

describe('coverColorValue', () => {
  it('resolves a known key', () => {
    expect(coverColorValue('accent_700')).toBe(colors.accent[700]);
  });

  it('falls back to dark green for an unknown key', () => {
    expect(coverColorValue('bogus')).toBe(colors.accent2[800]);
  });
});

describe('HUB_SECTIONS', () => {
  it('lists sections in the fixed order', () => {
    expect(HUB_SECTIONS).toEqual([
      { key: 'board', label: 'Board' },
      { key: 'games', label: 'Games' },
      { key: 'photos', label: 'Photos' },
      { key: 'members', label: 'Members' },
      { key: 'ranks', label: 'Ranks' },
    ]);
  });
});

describe('shareText', () => {
  it('formats the invite message', () => {
    expect(shareText('Tuesday Tiles', 'ABCD1234')).toBe(
      'Join Tuesday Tiles on MahjHero with code ABCD1234',
    );
  });
});

describe('shareClubCode', () => {
  const writeText = vi.fn();

  beforeEach(() => {
    writeText.mockReset();
    vi.mocked(Share.share).mockReset();
    Object.defineProperty(global, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    platformOS = 'web';
  });

  it('copies to the clipboard on web', async () => {
    platformOS = 'web';
    writeText.mockResolvedValueOnce(undefined);
    const result = await shareClubCode('Tuesday Tiles', 'ABCD1234');
    expect(writeText).toHaveBeenCalledWith('Join Tuesday Tiles on MahjHero with code ABCD1234');
    expect(result).toBe('copied');
  });

  it('uses the native Share sheet off web', async () => {
    platformOS = 'ios';
    vi.mocked(Share.share).mockResolvedValueOnce({ action: 'sharedAction' } as never);
    const result = await shareClubCode('Tuesday Tiles', 'ABCD1234');
    expect(Share.share).toHaveBeenCalledWith({
      message: 'Join Tuesday Tiles on MahjHero with code ABCD1234',
    });
    expect(result).toBe('shared');
  });

  it('reports failed when the clipboard write rejects', async () => {
    platformOS = 'web';
    writeText.mockRejectedValueOnce(new Error('nope'));
    expect(await shareClubCode('Tuesday Tiles', 'ABCD1234')).toBe('failed');
  });

  it('reports failed when native Share rejects', async () => {
    platformOS = 'ios';
    vi.mocked(Share.share).mockRejectedValueOnce(new Error('nope'));
    expect(await shareClubCode('Tuesday Tiles', 'ABCD1234')).toBe('failed');
  });
});
