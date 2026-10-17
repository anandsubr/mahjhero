import { describe, expect, it, vi } from 'vitest';
import { makeFetchWithClockSkewRetry } from './supabase-fetch';

const skew = () =>
  new Response(JSON.stringify({ code: 'PGRST303', message: 'JWT issued at future' }), { status: 401 });

function setup(responses: Response[]) {
  const fetchImpl = vi.fn();
  responses.forEach((r) => fetchImpl.mockResolvedValueOnce(r));
  const sleep = vi.fn().mockResolvedValue(undefined);
  return { fetchImpl, sleep, f: makeFetchWithClockSkewRetry({ fetchImpl, sleep }) };
}

describe('fetchWithClockSkewRetry', () => {
  it('retries once after PGRST303 and returns the retry', async () => {
    const ok = new Response('{"ok":true}', { status: 200 });
    const { f, fetchImpl, sleep } = setup([skew(), ok]);
    const init = { method: 'GET' };
    const res = await f('https://x/rest/v1/clubs', init);
    expect(res).toBe(ok);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://x/rest/v1/clubs', init);
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'https://x/rest/v1/clubs', init);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('retries only once', async () => {
    const second = skew();
    const { f, fetchImpl } = setup([skew(), second]);
    const res = await f('u');
    expect(res).toBe(second);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry other 401 codes', async () => {
    const r = new Response('{"code":"PGRST301","message":"JWT expired"}', { status: 401 });
    const { f, fetchImpl, sleep } = setup([r]);
    expect(await f('u')).toBe(r);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('passes 200 through with body still readable', async () => {
    const r = new Response('{"a":1}', { status: 200 });
    const { f, fetchImpl, sleep } = setup([r]);
    const res = await f('u');
    expect(await res.json()).toEqual({ a: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not crash or retry on a non-JSON 401', async () => {
    const r = new Response('<html>Unauthorized</html>', { status: 401 });
    const { f, fetchImpl } = setup([r]);
    const res = await f('u');
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('<html>Unauthorized</html>');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
