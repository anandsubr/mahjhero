import { describe, expect, it, vi } from 'vitest';
import { handleDeleteAccount, type DeleteAccountDeps } from '../handler';

function setup(opts: { user?: boolean; revokeOk?: boolean; deleteError?: unknown } = {}) {
  const calls: string[] = [];
  const remove = vi.fn(async () => ({ error: null }));
  const deps: DeleteAccountDeps = {
    userClient: {
      auth: {
        getUser: async () =>
          opts.user === false
            ? { data: { user: null }, error: { message: 'bad jwt' } }
            : { data: { user: { id: 'u1' } }, error: null },
      },
    },
    adminClient: {
      rpc: vi.fn(async () => {
        calls.push('rpc');
        return {
          data: [
            { bucket: 'message-images', path: 'a.png' },
            { bucket: 'club-media', path: 'b.png' },
            { bucket: 'message-images', path: 'c.png' },
          ],
          error: null,
        };
      }),
      storage: { from: vi.fn((b: string) => ({ remove: async (p: string[]) => { calls.push(`remove:${b}:${p.join(',')}`); return remove(); } })) },
      auth: { admin: { deleteUser: vi.fn(async () => { calls.push('deleteUser'); return { error: opts.deleteError ?? null }; }) } },
    },
    appleEnv: {},
    revoke: vi.fn(async () => ({ revoked: opts.revokeOk ?? true })),
  };
  return { deps, calls };
}

const req = (body?: unknown, auth = true) =>
  new Request('https://x/delete-account', {
    method: 'POST',
    headers: auth ? { Authorization: 'Bearer t' } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('handleDeleteAccount', () => {
  it('401s without an Authorization header', async () => {
    const { deps } = setup();
    expect((await handleDeleteAccount(req({}, false), deps)).status).toBe(401);
  });

  it('401s when the JWT does not resolve to a user', async () => {
    const { deps } = setup({ user: false });
    const res = await handleDeleteAccount(req({}), deps);
    expect(res.status).toBe(401);
    expect(deps.adminClient.rpc).not.toHaveBeenCalled();
  });

  it('runs RPC, removes storage grouped by bucket, then deletes the user', async () => {
    const { deps, calls } = setup();
    const res = await handleDeleteAccount(req({}), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(deps.adminClient.rpc).toHaveBeenCalledWith('delete_account_data', { target: 'u1' });
    expect(calls).toEqual([
      'rpc', 'remove:message-images:a.png,c.png', 'remove:club-media:b.png', 'deleteUser',
    ]);
    expect(deps.revoke).not.toHaveBeenCalled();
  });

  it('still deletes when Apple revocation fails', async () => {
    const { deps, calls } = setup({ revokeOk: false });
    const res = await handleDeleteAccount(req({ apple_authorization_code: 'code' }), deps);
    expect(deps.revoke).toHaveBeenCalledWith('code', {}, undefined);
    expect(res.status).toBe(200);
    expect(calls).toContain('deleteUser');
  });

  it('500s when deleteUser fails', async () => {
    const { deps } = setup({ deleteError: { message: 'boom' } });
    expect((await handleDeleteAccount(req({}), deps)).status).toBe(500);
  });
});
