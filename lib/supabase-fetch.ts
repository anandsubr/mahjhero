// Right after sign-in, the freshly minted access token's `iat` can be a fraction
// of a second ahead of PostgREST's clock, so the first request(s) fail with
// HTTP 401 / PGRST303 "JWT issued at future". Requests a moment later succeed,
// so we wait briefly and retry once.

const CLOCK_SKEW_DELAY_MS = 1000;

type FetchLike = (input: any, init?: any) => Promise<Response>;

export function makeFetchWithClockSkewRetry(opts: {
  fetchImpl: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
}): FetchLike {
  const { fetchImpl } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delayMs = opts.delayMs ?? CLOCK_SKEW_DELAY_MS;

  return async (input, init) => {
    const res = await fetchImpl(input, init);
    if (res.status !== 401) return res;

    let text = '';
    try {
      text = await res.clone().text();
    } catch {
      return res;
    }
    if (!text.includes('PGRST303') && !text.includes('JWT issued at future')) return res;

    await sleep(delayMs);
    return fetchImpl(input, init);
  };
}

export const fetchWithClockSkewRetry: FetchLike = makeFetchWithClockSkewRetry({
  fetchImpl: (input, init) => fetch(input, init),
});
