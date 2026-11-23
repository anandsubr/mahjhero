import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({ Platform: platform }));
vi.mock('expo-web-browser', () => ({ openBrowserAsync: vi.fn() }));

import * as WebBrowser from 'expo-web-browser';
import { LEGAL_URLS, openLegal } from './legal';

describe('openLegal', () => {
  afterEach(() => {
    vi.clearAllMocks();
    platform.OS = 'ios';
  });

  it('points at the published pages', () => {
    expect(LEGAL_URLS).toEqual({
      privacy: 'https://mahjhero.com/privacy/',
      terms: 'https://mahjhero.com/terms/',
    });
  });

  it('opens the in-app browser on native', async () => {
    await openLegal('terms');
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith('https://mahjhero.com/terms/');
  });

  it('opens a new tab on web', async () => {
    platform.OS = 'web';
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openLegal('privacy');
    expect(open).toHaveBeenCalledWith('https://mahjhero.com/privacy/', '_blank', 'noopener');
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});
