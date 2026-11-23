// Sign in with Apple token revocation (App Store guideline 5.1.1(v)).
// Every function here is injected with `now` / `fetchImpl` for tests, and
// revokeAppleToken never throws: account deletion must proceed even when
// Apple is unreachable or misconfigured.

export interface AppleEnv {
  teamId?: string;
  keyId?: string;
  privateKey?: string;
  clientId?: string;
}

export interface ClientSecretInput {
  teamId: string;
  keyId: string;
  privateKey: string;
  clientId: string;
  now: number; // epoch seconds
}

const APPLE_AUD = 'https://appleid.apple.com';

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ES256 client-secret JWT (5 minute lifetime) signed with the .p8 key. */
export async function makeClientSecret(input: ClientSecretInput): Promise<string> {
  const header = { alg: 'ES256', kid: input.keyId, typ: 'JWT' };
  const claims = {
    iss: input.teamId,
    iat: input.now,
    exp: input.now + 300,
    aud: APPLE_AUD,
    sub: input.clientId,
  };
  const signingInput = `${b64url(utf8(JSON.stringify(header)))}.${b64url(utf8(JSON.stringify(claims)))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(input.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // Web Crypto returns raw r||s (64 bytes), which is what JWT ES256 wants.
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    utf8(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

export type RevokeResult = { revoked: boolean; reason?: string };

export async function revokeAppleToken(
  code: string,
  env: AppleEnv,
  fetchImpl: typeof fetch = fetch,
  now: number = Math.floor(Date.now() / 1000),
): Promise<RevokeResult> {
  if (!env.teamId || !env.keyId || !env.privateKey || !env.clientId) {
    return { revoked: false, reason: 'not_configured' };
  }
  try {
    const clientSecret = await makeClientSecret({
      teamId: env.teamId,
      keyId: env.keyId,
      privateKey: env.privateKey,
      clientId: env.clientId,
      now,
    });
    const post = (path: string, fields: Record<string, string>) =>
      fetchImpl(`${APPLE_AUD}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      });

    const tokenRes = await post('/auth/token', {
      client_id: env.clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    });
    if (!tokenRes.ok) return { revoked: false, reason: 'token_exchange_failed' };
    const tokens = (await tokenRes.json()) as { refresh_token?: string };
    if (!tokens.refresh_token) return { revoked: false, reason: 'no_refresh_token' };

    const revokeRes = await post('/auth/revoke', {
      client_id: env.clientId,
      client_secret: clientSecret,
      token: tokens.refresh_token,
      token_type_hint: 'refresh_token',
    });
    if (!revokeRes.ok) return { revoked: false, reason: 'revoke_failed' };
    return { revoked: true };
  } catch (cause) {
    return { revoked: false, reason: `error: ${(cause as Error).message}` };
  }
}
