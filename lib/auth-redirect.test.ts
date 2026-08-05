// `completeAuthRedirect` is the one place a Supabase auth redirect becomes a
// session, reached from two directions: WebBrowser.openAuthSessionAsync (OAuth)
// and the OS deep link (magic link). Its behaviour is tested here once rather
// than twice through each caller.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: { auth: { signInWithOtp: vi.fn(), signInWithOAuth: vi.fn(), setSession: vi.fn() } },
}));

// See lib/auth.test.ts: these transitively pull in expo-modules-core, which
// needs a native `expo` global that does not exist under Vitest.
vi.mock('expo-linking', () => ({ createURL: vi.fn(() => 'mahjhero://auth/callback') }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }));

import { completeAuthRedirect, __resetConsumedRedirectUrls } from './auth';
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

const TOKEN_URL =
  'mahjhero://auth/callback#access_token=abc123&refresh_token=def456&token_type=bearer';

beforeEach(() => {
  __resetConsumedRedirectUrls();
  vi.mocked(supabase.auth.setSession).mockReset();
  vi.mocked(supabase.auth.setSession).mockResolvedValue({ error: null } as never);
});

describe('completeAuthRedirect', () => {
  it('turns a fragment carrying tokens into a session', async () => {
    await expect(completeAuthRedirect(TOKEN_URL)).resolves.toEqual({
      handled: true,
      error: null,
    });

    expect(supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: 'abc123',
      refresh_token: 'def456',
    });
  });

  it('ignores a deep link that is not an auth redirect', async () => {
    // Deep links are a shared channel. A future mahjhero://game/123 must pass
    // through here without touching the session.
    await expect(completeAuthRedirect('mahjhero://game/123')).resolves.toEqual({
      handled: false,
      error: null,
    });

    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });

  it('surfaces an error_description from the redirect and skips setSession', async () => {
    await expect(
      completeAuthRedirect(
        'mahjhero://auth/callback#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
      ),
    ).resolves.toEqual({
      handled: true,
      error: 'Email link is invalid or has expired',
    });

    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });

  it('falls back to the generic message when an error carries no description', async () => {
    await expect(
      completeAuthRedirect('mahjhero://auth/callback#error_code=otp_expired'),
    ).resolves.toEqual({ handled: true, error: GENERIC_ERROR });
  });

  it('does not replay a URL it has already consumed', async () => {
    // The case this exists for: on Android the OS can deliver the same
    // redirect to Linking that openAuthSessionAsync already handled. Calling
    // setSession twice would present an already-rotated refresh token, and
    // GoTrue rejecting it would turn a successful sign-in into an error.
    await completeAuthRedirect(TOKEN_URL);
    await expect(completeAuthRedirect(TOKEN_URL)).resolves.toEqual({
      handled: false,
      error: null,
    });

    expect(supabase.auth.setSession).toHaveBeenCalledTimes(1);
  });

  it('surfaces a setSession failure rather than reporting success', async () => {
    vi.mocked(supabase.auth.setSession).mockResolvedValue({
      error: { message: 'Invalid refresh token' },
    } as never);

    await expect(completeAuthRedirect(TOKEN_URL)).resolves.toEqual({
      handled: true,
      error: 'Invalid refresh token',
    });
  });

  it('resolves with an error instead of rejecting when setSession throws', async () => {
    vi.mocked(supabase.auth.setSession).mockRejectedValue(new Error('network down'));

    await expect(completeAuthRedirect(TOKEN_URL)).resolves.toEqual({
      handled: true,
      error: GENERIC_ERROR,
    });
  });
});
