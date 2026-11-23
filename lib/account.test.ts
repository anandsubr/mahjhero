import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn(), signOut: vi.fn(async () => ({ error: null })) },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock('expo-apple-authentication', () => ({ signInAsync: vi.fn() }));

import * as AppleAuthentication from 'expo-apple-authentication';
import { deleteAccount } from './account';
import { GENERIC_ERROR } from './constants';
import { supabase } from './supabase';

function user(providers: string[]) {
  vi.mocked(supabase.auth.getUser).mockResolvedValue({
    data: { user: { identities: providers.map((provider) => ({ provider })) } },
    error: null,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: { deleted: true },
    error: null,
  } as never);
});

describe('deleteAccount', () => {
  it('passes the Apple authorization code, then signs out', async () => {
    user(['apple']);
    vi.mocked(AppleAuthentication.signInAsync).mockResolvedValue({
      authorizationCode: 'code1',
    } as never);
    expect(await deleteAccount()).toEqual({ error: null });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-account', {
      body: { apple_authorization_code: 'code1' },
    });
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('proceeds without a code when the Apple sheet is cancelled', async () => {
    user(['apple']);
    vi.mocked(AppleAuthentication.signInAsync).mockRejectedValue({
      code: 'ERR_REQUEST_CANCELED',
    });
    expect(await deleteAccount()).toEqual({ error: null });
    expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-account', { body: {} });
  });

  it('skips Apple for non-Apple accounts', async () => {
    user(['email']);
    await deleteAccount();
    expect(AppleAuthentication.signInAsync).not.toHaveBeenCalled();
  });

  it('returns an error and stays signed in when the function fails', async () => {
    user(['email']);
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    } as never);
    expect(await deleteAccount()).toEqual({ error: GENERIC_ERROR });
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });
});
