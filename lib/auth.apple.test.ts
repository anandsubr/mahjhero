// vitest aliases 'react-native' to react-native-web (Platform.OS 'web'); the
// native Apple flow is exercised by mocking the Apple + crypto modules.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('./supabase', () => ({
  supabase: { auth: { signInWithIdToken: vi.fn() } },
}));
vi.mock('./profile', () => ({ fetchProfile: vi.fn(), updateProfile: vi.fn() }));
vi.mock('expo-linking', () => ({ createURL: vi.fn() }));
vi.mock('expo-web-browser', () => ({ openAuthSessionAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({
  getRandomBytes: vi.fn(() => new Uint8Array(32).fill(1)),
  digestStringAsync: vi.fn(async () => 'HASHED'),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));
vi.mock('expo-apple-authentication', () => ({
  signInAsync: vi.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { signInWithApple } from './auth';
import { GENERIC_ERROR } from './constants';
import { fetchProfile, updateProfile } from './profile';
import { supabase } from './supabase';

const RAW = '01'.repeat(32);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(supabase.auth.signInWithIdToken).mockResolvedValue({
    data: { user: { id: 'u1' }, session: {} },
    error: null,
  } as never);
  vi.mocked(updateProfile).mockResolvedValue({ error: null });
});

describe('signInWithApple', () => {
  it('sends the hashed nonce to Apple and the raw nonce to Supabase', async () => {
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: 'tok',
      fullName: null,
    } as never);
    expect(await signInWithApple()).toEqual({ error: null });
    expect(Crypto.digestStringAsync).toHaveBeenCalledWith('SHA-256', RAW);
    expect(AppleAuthentication.signInAsync).toHaveBeenCalledWith({
      requestedScopes: [0, 1],
      nonce: 'HASHED',
    });
    expect(supabase.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'tok',
      nonce: RAW,
    });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('saves the full name when the profile has none', async () => {
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: 'tok',
      fullName: { givenName: 'Jane', familyName: 'Doe' },
    } as never);
    vi.mocked(fetchProfile).mockResolvedValue({ display_name: '' } as never);
    await signInWithApple();
    expect(updateProfile).toHaveBeenCalledWith('u1', { display_name: 'Jane Doe' });
  });

  it('keeps an existing display name', async () => {
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: 'tok',
      fullName: { givenName: 'Jane', familyName: 'Doe' },
    } as never);
    vi.mocked(fetchProfile).mockResolvedValue({ display_name: 'Janie' } as never);
    await signInWithApple();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('resolves quietly when the person cancels', async () => {
    vi.mocked(AppleAuthentication.signInAsync).mockRejectedValue({
      code: 'ERR_REQUEST_CANCELED',
    });
    expect(await signInWithApple()).toEqual({ error: null });
    expect(supabase.auth.signInWithIdToken).not.toHaveBeenCalled();
  });

  it('returns Supabase errors', async () => {
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      identityToken: 'tok',
    } as never);
    vi.mocked(supabase.auth.signInWithIdToken).mockResolvedValue({
      data: {},
      error: { message: 'bad token' },
    } as never);
    expect(await signInWithApple()).toEqual({ error: GENERIC_ERROR });
  });
});
