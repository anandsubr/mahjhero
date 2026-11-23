import { corsHeaders } from '../_shared/cors.ts';
import { revokeAppleToken, type AppleEnv, type RevokeResult } from './apple.ts';

// Structural subsets of the supabase-js client, so tests can inject fakes
// without the esm.sh import.
export interface DeleteAccountDeps {
  /** Client built from the caller's Authorization header (anon key). */
  userClient: {
    auth: {
      getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    };
  };
  /** Service-role client. */
  adminClient: {
    rpc(
      fn: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: { bucket: string; path: string }[] | null; error: unknown }>;
    storage: {
      from(bucket: string): {
        remove(paths: string[]): PromiseLike<{ error: unknown }>;
      };
    };
    auth: {
      admin: { deleteUser(id: string): PromiseLike<{ error: unknown }> };
    };
  };
  appleEnv: AppleEnv;
  fetchImpl?: typeof fetch;
  revoke?: (code: string, env: AppleEnv, f?: typeof fetch) => Promise<RevokeResult>;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export async function handleDeleteAccount(
  request: Request,
  deps: DeleteAccountDeps | (() => DeleteAccountDeps),
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!request.headers.get('Authorization')) {
    return json({ error: 'missing Authorization header' }, 401);
  }

  let code: string | undefined;
  try {
    const body = (await request.json()) as { apple_authorization_code?: unknown } | null;
    if (typeof body?.apple_authorization_code === 'string' && body.apple_authorization_code) {
      code = body.apple_authorization_code;
    }
  } catch {
    // Empty/invalid body is fine: the code is optional.
  }

  const d = typeof deps === 'function' ? deps() : deps;

  const { data, error: userError } = await d.userClient.auth.getUser();
  const userId = data?.user?.id;
  if (userError || !userId) return json({ error: 'unauthorized' }, 401);

  // Revocation runs first on purpose: the code is single-use, so if the RPC
  // fails and the client retries, the retry simply proceeds without revocation.
  if (code) {
    const result = await (d.revoke ?? revokeAppleToken)(code, d.appleEnv, d.fetchImpl);
    if (!result.revoked) console.warn('delete-account: apple revocation skipped', result.reason);
  }

  const { data: files, error: rpcError } = await d.adminClient.rpc('delete_account_data', {
    target: userId,
  });
  if (rpcError) {
    console.error('delete-account: delete_account_data failed', rpcError);
    return json({ error: 'failed to delete account data' }, 500);
  }

  const byBucket = new Map<string, string[]>();
  for (const f of files ?? []) {
    const list = byBucket.get(f.bucket);
    if (list) list.push(f.path);
    else byBucket.set(f.bucket, [f.path]);
  }
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 1000) {
      const { error } = await d.adminClient.storage.from(bucket).remove(paths.slice(i, i + 1000));
      // Orphaned files are not worth blocking deletion over.
      if (error) console.error('delete-account: storage remove failed', bucket, error);
    }
  }

  const { error: deleteError } = await d.adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('delete-account: deleteUser failed', deleteError);
    return json({ error: 'failed to delete account' }, 500);
  }

  return json({ deleted: true }, 200);
}
