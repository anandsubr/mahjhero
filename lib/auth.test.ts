import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: vi.fn().mockRejectedValue(new Error('network down')),
      signInWithOAuth: vi.fn().mockRejectedValue(new Error('network down')),
      setSession: vi.fn(),
    },
  },
}));

// expo-linking and expo-web-browser both transitively pull in
// expo-modules-core, which expects a native `expo` global that does not
// exist under Vitest/Node — importing them for real crashes at module load
// (`Cannot read properties of undefined (reading 'EventEmitter')`). They are
// stubbed here so this file (and any file importing ./auth) can load at all.
// This file's Platform.OS is 'web' (see vitest.config.mts), so
// signInWithProvider's native branch — the one that actually calls these —
// is exercised separately in lib/auth.native-oauth.test.ts with an explicit
// Platform.OS override.
vi.mock('expo-linking', () => ({
  createURL: vi.fn(() => 'https://mahjhero.test/auth/callback'),
}));

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(),
}));

import { availableProviders, isValidEmail, sendMagicLink, signInWithProvider } from './auth';
import { supabase } from './supabase';
import * as WebBrowser from 'expo-web-browser';

describe('isValidEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isValidEmail('jane@example.com')).toBe(true);
  });

  it('accepts an address with a plus tag', () => {
    expect(isValidEmail('jane+mahjong@example.co.uk')).toBe(true);
  });

  it('trims surrounding whitespace before judging', () => {
    expect(isValidEmail('  jane@example.com  ')).toBe(true);
  });

  it('rejects an address with no domain', () => {
    expect(isValidEmail('jane@')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidEmail('')).toBe(false);
  });
});

describe('sendMagicLink', () => {
  it('resolves with an error instead of rejecting when the underlying call throws', async () => {
    await expect(sendMagicLink('jane@example.com')).resolves.toEqual({
      error: 'Could not reach MahjHero. Check your connection and try again.',
    });
  });
});

describe('availableProviders', () => {
  it('offers Apple alongside Google on iOS, as Guideline 4.8 requires', () => {
    expect(availableProviders('ios')).toEqual(['google', 'apple']);
  });

  it('offers only Google on Android', () => {
    expect(availableProviders('android')).toEqual(['google']);
  });

  it('offers both on web', () => {
    expect(availableProviders('web')).toEqual(['google', 'apple']);
  });
});

describe('signInWithProvider', () => {
  it('resolves with an error instead of rejecting when the underlying call throws', async () => {
    await expect(signInWithProvider('google')).resolves.toEqual({
      error: 'Could not reach MahjHero. Check your connection and try again.',
    });
  });

  it('on web, returns after signInWithOAuth without opening a native auth session', async () => {
    // Platform.OS is 'web' in this file (see vitest.config.mts). On web,
    // @supabase/auth-js navigates the page itself; this app must not also
    // try to open a second browser session on top of that.
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValueOnce({
      data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/authorize' },
      error: null,
    } as never);

    await expect(signInWithProvider('google')).resolves.toEqual({ error: null });

    expect(supabase.auth.signInWithOAuth).toHaveBeenLastCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://mahjhero.test/auth/callback',
        skipBrowserRedirect: false,
      },
    });
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });
});
