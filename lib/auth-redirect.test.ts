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
      status: 'signed-in',
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
      status: 'ignored',
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
      status: 'failed',
      error: 'Email link is invalid or has expired',
    });

    expect(supabase.auth.setSession).not.toHaveBeenCalled();
  });

  it('falls back to the generic message when an error carries no description', async () => {
    await expect(
      completeAuthRedirect('mahjhero://auth/callback#error_code=otp_expired'),
    ).resolves.toEqual({ status: 'failed', error: GENERIC_ERROR });
  });

  it('reports a URL that already produced a session as already-signed-in, not as a replay', async () => {
    // The case this exists for: on Android both arrival paths see the same
    // redirect. Calling setSession twice would present an already-rotated
    // refresh token, and GoTrue rejecting it would turn a successful sign-in
    // into an error — so the second caller is told the session already exists
    // rather than being allowed to replay it.
    await completeAuthRedirect(TOKEN_URL);
    await expect(completeAuthRedirect(TOKEN_URL)).resolves.toEqual({
      status: 'already-signed-in',
      error: null,
    });

    expect(supabase.auth.setSession).toHaveBeenCalledTimes(1);
  });

  it('surfaces a setSession failure rather than reporting success', async () => {
    vi.mocked(supabase.auth.setSession).mockResolvedValue({
      error: { message: 'Invalid refresh token' },
    } as never);

    await expect(completeAuthRedirect(TOKEN_URL)).resolves.toEqual({
      status: 'failed',
      error: 'Invalid refresh token',
    });
  });

  it('resolves with an error instead of rejecting when setSession throws', async () => {
    vi.mocked(supabase.auth.setSession).mockRejectedValue(new Error('network down'));

    await expect(completeAuthRedirect(TOKEN_URL)).resolves.toEqual({
      status: 'failed',
      error: GENERIC_ERROR,
    });
  });

  it('does not burn a redirect whose setSession failed, so the other path can retry', async () => {
    // The two arrival paths (openAuthSessionAsync and the deep-link listener)
    // are each other's retry. Marking the URL consumed on a transient failure
    // would spend the member's only link on a blip.
    vi.mocked(supabase.auth.setSession).mockResolvedValueOnce({
      error: { message: 'temporary failure' },
    } as never);

    await expect(completeAuthRedirect(TOKEN_URL)).resolves.toEqual({
      status: 'failed',
      error: 'temporary failure',
    });

    await expect(completeAuthRedirect(TOKEN_URL)).resolves.toEqual({
      status: 'signed-in',
      error: null,
    });
    expect(supabase.auth.setSession).toHaveBeenCalledTimes(2);
  });

  it('does not record an error redirect as consumed', async () => {
    // Nothing was spent, so if the same error arrives down both paths both
    // callers should be able to report it rather than the second seeing a
    // phantom success.
    const errorUrl = 'mahjhero://auth/callback#error_code=otp_expired';

    await completeAuthRedirect(errorUrl);
    await expect(completeAuthRedirect(errorUrl)).resolves.toEqual({
      status: 'failed',
      error: GENERIC_ERROR,
    });
  });
});
