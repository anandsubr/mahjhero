import { describe, expect, it, vi } from 'vitest';
import { makeClientSecret, revokeAppleToken } from '../apple';

async function testKey() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString('base64')}\n-----END PRIVATE KEY-----`;
  return { pem, publicKey: pair.publicKey };
}

const dec = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());

describe('makeClientSecret', () => {
  it('builds an ES256 JWT with Apple claims that verifies against the public key', async () => {
    const { pem, publicKey } = await testKey();
    const jwt = await makeClientSecret({
      teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: pem, clientId: 'com.example.app', now: 1000,
    });
    const [h, c, s] = jwt.split('.');
    expect(dec(h)).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect(dec(c)).toEqual({
      iss: 'TEAM123456', iat: 1000, exp: 1300, aud: 'https://appleid.apple.com', sub: 'com.example.app',
    });
    const sig = Buffer.from(s, 'base64url');
    expect(sig.length).toBe(64);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, publicKey, sig, new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });
});

describe('revokeAppleToken', () => {
  const mkEnv = async () => {
    const { pem } = await testKey();
    return { teamId: 'T', keyId: 'K', privateKey: pem, clientId: 'com.example.app' };
  };

  it('exchanges the code then revokes the refresh token', async () => {
    const env = await mkEnv();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ refresh_token: 'rt', access_token: 'at' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const res = await revokeAppleToken('auth-code', env, fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ revoked: true });
    const [url1, init1] = fetchImpl.mock.calls[0];
    const [url2, init2] = fetchImpl.mock.calls[1];
    expect(url1).toBe('https://appleid.apple.com/auth/token');
    const b1 = new URLSearchParams(init1.body);
    expect(b1.get('client_id')).toBe('com.example.app');
    expect(b1.get('code')).toBe('auth-code');
    expect(b1.get('grant_type')).toBe('authorization_code');
    expect(b1.get('client_secret')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(url2).toBe('https://appleid.apple.com/auth/revoke');
    const b2 = new URLSearchParams(init2.body);
    expect(b2.get('token')).toBe('rt');
    expect(b2.get('token_type_hint')).toBe('refresh_token');
    expect(b2.get('client_id')).toBe('com.example.app');
  });

  it('returns revoked:false when token exchange fails', async () => {
    const env = await mkEnv();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
    const res = await revokeAppleToken('bad', env, fetchImpl as unknown as typeof fetch);
    expect(res.revoked).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('never throws when fetch rejects', async () => {
    const env = await mkEnv();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    expect((await revokeAppleToken('c', env, fetchImpl as unknown as typeof fetch)).revoked).toBe(false);
  });

  it('skips with not_configured when Apple env is missing', async () => {
    const fetchImpl = vi.fn();
    const res = await revokeAppleToken('c', {}, fetchImpl as unknown as typeof fetch);
    expect(res).toEqual({ revoked: false, reason: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
