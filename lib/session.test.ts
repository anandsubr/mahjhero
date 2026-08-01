import { describe, expect, it } from 'vitest';
import { resolveSessionState } from './session';

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
