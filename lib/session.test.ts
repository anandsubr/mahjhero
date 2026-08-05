import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  },
}));

import { resolveSessionState, subscribeToSession } from './session';
import type { SetSession } from './session';
import { supabase } from './supabase';

const unsubscribe = vi.fn();

/**
 * `subscribeToSession` writes through a React setter, and the whole point of
 * the guards is *how* it writes — functional updaters that inspect what is
 * already there. So the fake keeps a value and applies updaters to it, exactly
 * as useState would, rather than just recording arguments.
 */
function fakeSetter(initial: Session | null | undefined) {
  let current = initial;
  const set = ((next) => {
    current = typeof next === 'function' ? (next as (c: typeof current) => typeof current)(current) : next;
  }) as SetSession;
  return { set, read: () => current };
}

beforeEach(() => {
  unsubscribe.mockReset();
  vi.mocked(supabase.auth.onAuthStateChange).mockReset();
  vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
    data: { subscription: { unsubscribe } },
  } as never);
  vi.mocked(supabase.auth.getSession).mockReset();
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: null },
  } as never);
});

describe('resolveSessionState', () => {
  it('is loading before the first auth event', () => {
    expect(resolveSessionState(undefined)).toEqual({
      session: null,
      loading: true,
    });
  });

  it('is signed out when the first event carries no session', () => {
    expect(resolveSessionState(null)).toEqual({
      session: null,
      loading: false,
    });
  });

  it('is signed in when a session arrives', () => {
    const session = { access_token: 'token', user: { id: 'abc' } } as never;
    expect(resolveSessionState(session)).toEqual({
      session,
      loading: false,
    });
  });
});

describe('subscribeToSession', () => {
  it('resolves to signed-out when getSession rejects, instead of loading forever', async () => {
    // Corrupt persisted storage or a full quota. Without the catch, `session`
    // stays undefined and `loading` stays true, holding every screen in the
    // app on a bare ActivityIndicator with no exit.
    vi.mocked(supabase.auth.getSession).mockRejectedValue(new Error('quota exceeded'));
    const setter = fakeSetter(undefined);

    subscribeToSession(setter.set);
    await vi.waitFor(() => expect(setter.read()).toBeNull());

    expect(resolveSessionState(setter.read())).toEqual({
      session: null,
      loading: false,
    });
  });

  it('does not sign out a member already signed in when getSession rejects late', async () => {
    // getSession and the deep-link handler's setSession are not serialized —
    // auth-js's `lock` defaults to null. A rejection arriving after
    // onAuthStateChange has established a session must leave it alone.
    vi.mocked(supabase.auth.getSession).mockRejectedValue(new Error('quota exceeded'));
    const live = { access_token: 'token', user: { id: 'abc' } } as never;
    const setter = fakeSetter(live);

    subscribeToSession(setter.set);
    await vi.waitFor(() => expect(supabase.auth.getSession).toHaveBeenCalled());

    expect(setter.read()).toBe(live);
  });

  it('does not overwrite a live session with an empty storage read', async () => {
    // The same race as above, on the success path: the storage read comes back
    // empty but its callback queues behind SIGNED_IN. Writing unconditionally
    // here signs the member straight back out — which is exactly what happens
    // on a cold launch from a magic link.
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
    } as never);
    const live = { access_token: 'token', user: { id: 'abc' } } as never;
    const setter = fakeSetter(live);

    subscribeToSession(setter.set);
    await vi.waitFor(() => expect(supabase.auth.getSession).toHaveBeenCalled());

    expect(setter.read()).toBe(live);
  });

  it('applies the stored session when nothing has arrived yet', async () => {
    const stored = { access_token: 'stored', user: { id: 'abc' } } as never;
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: stored },
    } as never);
    const setter = fakeSetter(undefined);

    subscribeToSession(setter.set);
    await vi.waitFor(() => expect(setter.read()).toBe(stored));
  });

  it('lets every auth event win, including a sign-out', async () => {
    // Later events are newer than anything getSession can report, so this
    // writer is deliberately unguarded.
    const setter = fakeSetter(undefined);
    subscribeToSession(setter.set);

    const handler = vi.mocked(supabase.auth.onAuthStateChange).mock.calls[0][0];
    const signedIn = { access_token: 'token', user: { id: 'abc' } } as never;

    handler('SIGNED_IN', signedIn);
    expect(setter.read()).toBe(signedIn);

    handler('SIGNED_OUT', null);
    expect(setter.read()).toBeNull();
  });

  it('unsubscribes through the returned cleanup', () => {
    const setter = fakeSetter(undefined);
    subscribeToSession(setter.set)();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
