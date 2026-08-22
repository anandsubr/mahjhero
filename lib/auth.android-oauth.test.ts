// Android runs the OAuth redirect through a different mechanism than iOS, and
// the difference is not cosmetic — it inverts who sees the redirect first.
//
// iOS has a real ASWebAuthenticationSession: the redirect is captured
// in-process and `Linking` never sees it. Android has no such thing, so
// expo-web-browser opens a Custom Tab and polyfills `openAuthSessionAsync`
// with its own `Linking` listener registered at tap time. useAuthDeepLink's
// listener was registered at root mount, so it is ahead in the queue: it
// consumes the redirect and establishes the session *before*
// openAuthSessionAsync resolves.
//
// signInWithProvider therefore reaches completeAuthRedirect second, with a URL
// that has already produced a session. Treating that as "nothing happened"
// showed "Could not reach MahjHero" on every successful Android sign-in —
// deterministically, not flakily. lib/auth.native-oauth.test.ts pins
// Platform.OS to 'ios', so nothing covered this.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      signInWithOAuth: vi.fn(),
      setSession: vi.fn(),
    },
  },
}));

vi.mock('expo-linking', () => ({
  createURL: vi.fn(() => 'mahjhero://auth/callback'),
}));

vi.mock('expo-web-browser', () => ({
  openAuthSessionAsync: vi.fn(),
}));

import {
  completeAuthRedirect,
  signInWithProvider,
  __resetConsumedRedirectUrls,
} from './auth';
import { supabase } from './supabase';
import * as WebBrowser from 'expo-web-browser';

const REDIRECT_URL =
  'mahjhero://auth/callback#access_token=abc123&refresh_token=def456&token_type=bearer';

beforeEach(() => {
  vi.mocked(supabase.auth.signInWithOAuth).mockReset();
  vi.mocked(supabase.auth.setSession).mockReset();
  vi.mocked(supabase.auth.setSession).mockResolvedValue({ error: null } as never);
  vi.mocked(WebBrowser.openAuthSessionAsync).mockReset();
  __resetConsumedRedirectUrls();
});

describe('signInWithProvider on Android', () => {
  it('reports success when the deep-link handler consumed the redirect first', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/authorize' },
      error: null,
    } as never);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async () => {
      // Stands in for useAuthDeepLink's listener firing first, which on
      // Android is what actually happens.
      await completeAuthRedirect(REDIRECT_URL);
      return { type: 'success', url: REDIRECT_URL } as never;
    });

    await expect(signInWithProvider('google')).resolves.toEqual({ error: null });

    // Exactly one: the second pass must not replay an already-rotated
    // refresh token, which GoTrue would reject.
    expect(supabase.auth.setSession).toHaveBeenCalledTimes(1);
  });

  it('still drives the redirect itself when it is first to the URL', async () => {
    // The other ordering has to keep working: if openAuthSessionAsync wins,
    // signInWithProvider is the one that establishes the session.
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/authorize' },
      error: null,
    } as never);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: 'success',
      url: REDIRECT_URL,
    } as never);

    await expect(signInWithProvider('google')).resolves.toEqual({ error: null });

    expect(supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: 'abc123',
      refresh_token: 'def456',
    });
  });

  it('offers only Google, since Guideline 4.8 is an iOS rule', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/authorize' },
      error: null,
    } as never);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: 'cancel',
    } as never);

    await signInWithProvider('google');

    // Confirms this file really is on the native branch: on web,
    // signInWithProvider returns before opening any auth session.
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalled();
    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'mahjhero://auth/callback',
        skipBrowserRedirect: true,
      },
    });
  });
});
