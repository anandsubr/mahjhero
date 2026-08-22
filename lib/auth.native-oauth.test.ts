// vitest.config.mts aliases 'react-native' -> 'react-native-web', which
// hardcodes Platform.OS === 'web'. signInWithProvider's native branch (the
// one that actually matters — see lib/auth.ts's comment on why
// signInWithOAuth alone is a no-op on React Native) is invisible to any
// test that doesn't override this explicitly. This file does that, and so
// is the only place that branch is exercised at all.
//
// What this DOES verify: the branching logic — which options are passed to
// signInWithOAuth, that the native auth session is opened with the right
// URL, that a successful round trip calls setSession with the parsed
// tokens, and that cancellation/error outcomes are handled correctly.
//
// What this does NOT verify: an actual device/simulator round trip through
// a real browser, a real Google/Apple consent screen, or a real Supabase
// redirect. See the Task 7b report for what remains unverified.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

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

import { signInWithProvider, __resetConsumedRedirectUrls } from './auth';
import { supabase } from './supabase';
import * as WebBrowser from 'expo-web-browser';

beforeEach(() => {
  vi.mocked(supabase.auth.signInWithOAuth).mockReset();
  vi.mocked(supabase.auth.setSession).mockReset();
  vi.mocked(WebBrowser.openAuthSessionAsync).mockReset();
  // completeAuthRedirect refuses to replay a redirect URL it has already
  // consumed, and that set is module state outliving a single test.
  __resetConsumedRedirectUrls();
});

describe('signInWithProvider on native (iOS)', () => {
  it('asks signInWithOAuth to skip the browser redirect and passes the deep-link redirect URL', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/authorize' },
      error: null,
    } as never);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: 'cancel' } as never);

    await signInWithProvider('google');

    expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'mahjhero://auth/callback',
        skipBrowserRedirect: true,
      },
    });
  });

  it('opens the authorize URL from signInWithOAuth in a native auth session', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'apple', url: 'https://appleid.apple.com/auth/authorize' },
      error: null,
    } as never);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: 'cancel' } as never);

    await signInWithProvider('apple');

    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      'https://appleid.apple.com/auth/authorize',
      'mahjhero://auth/callback',
    );
  });

  it('on a successful round trip, parses the tokens from the redirect and calls setSession', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/authorize' },
      error: null,
    } as never);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: 'success',
      url: 'mahjhero://auth/callback#access_token=abc123&refresh_token=def456&token_type=bearer',
    } as never);
    vi.mocked(supabase.auth.setSession).mockResolvedValue({ error: null } as never);

    await expect(signInWithProvider('google')).resolves.toEqual({ error: null });

    expect(supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: 'abc123',
      refresh_token: 'def456',
    });
  });

  it('treats the user backing out of the auth session as a non-error, with no setSession call', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/authorize' },
      error: null,
    } as never);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({ type: 'cancel' } as never);

    await expect(signInWithProvider('google')).resolves.toEqual({ error: null });

    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });

  it('surfaces an error_description carried on the redirect URL and skips setSession', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/authorize' },
      error: null,
    } as never);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: 'success',
      url: 'mahjhero://auth/callback#error=access_denied&error_code=user_denied&error_description=User+denied+access',
    } as never);

    await expect(signInWithProvider('google')).resolves.toEqual({
      error: 'User denied access',
    });

    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });

  it('reports the generic error when the auth session returns a URL carrying nothing', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: 'https://accounts.google.com/authorize' },
      error: null,
    } as never);
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: 'success',
      url: 'mahjhero://auth/callback',
    } as never);

    await expect(signInWithProvider('google')).resolves.toEqual({
      error: 'Could not reach MahjHero. Check your connection and try again.',
    });

    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });

  it('reports the generic error when signInWithOAuth resolves without an authorize URL', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: null },
      error: null,
    } as never);

    await expect(signInWithProvider('google')).resolves.toEqual({
      error: 'Could not reach MahjHero. Check your connection and try again.',
    });

    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it('surfaces a Supabase error from signInWithOAuth itself without opening a browser', async () => {
    vi.mocked(supabase.auth.signInWithOAuth).mockResolvedValue({
      data: { provider: 'google', url: null },
      error: { message: 'provider is not enabled' },
    } as never);

    await expect(signInWithProvider('google')).resolves.toEqual({
      error: 'provider is not enabled',
    });

    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });
});
