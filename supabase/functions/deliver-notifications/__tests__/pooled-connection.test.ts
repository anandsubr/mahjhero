import { describe, expect, it, vi } from 'vitest';
import { PooledConnection } from '../pooled-connection';

/**
 * The reuse/discard state machine `SmtpSender` (smtp.ts) composes rather
 * than owning itself — pulled into its own dependency-free class
 * specifically so it can be tested directly. smtp.ts imports denomailer via
 * a `https://deno.land/...` URL, which Vitest cannot resolve (see its own
 * docstring), so before this extraction the only regression guard for the
 * teardown-on-failure fix was `render.test.ts`'s
 * `ConnectionPoisoningFakeSender` — which pins the *consequence* of the bug
 * this class exists to prevent, not the fix itself. These tests exercise
 * the fix directly: a fresh client per `open`, reused until `discard`, and
 * a `discard` that never lets a `teardown` failure escape.
 */
describe('PooledConnection', () => {
  it('opens a fresh client on first use', () => {
    let created = 0;
    const pool = new PooledConnection(
      () => ({ id: ++created }),
      async () => {},
    );

    const client = pool.get();

    expect(client).toEqual({ id: 1 });
    expect(created).toBe(1);
  });

  it('reuses the same client across calls, without opening a second one', () => {
    let created = 0;
    const pool = new PooledConnection(
      () => ({ id: ++created }),
      async () => {},
    );

    const first = pool.get();
    const second = pool.get();

    expect(second).toBe(first);
    expect(created).toBe(1);
  });

  // The fix this whole class exists for: after a failure, the next `get()`
  // must not hand back the same (possibly poisoned) client.
  it('discards the current client so the next get() opens another', async () => {
    let created = 0;
    const pool = new PooledConnection(
      () => ({ id: ++created }),
      async () => {},
    );

    const first = pool.get();
    await pool.discard();
    const second = pool.get();

    expect(created).toBe(2);
    expect(second).not.toBe(first);
    expect(second).toEqual({ id: 2 });
  });

  it('tears down the discarded client, exactly the one that was live', async () => {
    const teardown = vi.fn(async () => {});
    const pool = new PooledConnection(() => ({ id: 1 }), teardown);

    const client = pool.get();
    await pool.discard();

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledWith(client);
  });

  it('discarding with no live client is a no-op — teardown is never called', async () => {
    const teardown = vi.fn(async () => {});
    const pool = new PooledConnection(() => ({ id: 1 }), teardown);

    await pool.discard();

    expect(teardown).not.toHaveBeenCalled();
  });

  // The other half of the fix: denomailer's own close can throw (the
  // connection may already be dead), and that must never come out of
  // `discard` and mask the real failure the caller is already unwinding
  // from.
  it('does not let a teardown failure escape discard', async () => {
    const pool = new PooledConnection(
      () => ({ id: 1 }),
      async () => {
        throw new Error('close failed: bad resource id');
      },
    );

    pool.get();
    await expect(pool.discard()).resolves.toBeUndefined();
  });

  it('reports a teardown failure to the optional callback instead of swallowing it silently', async () => {
    const teardownError = new Error('close failed: bad resource id');
    const pool = new PooledConnection(
      () => ({ id: 1 }),
      async () => {
        throw teardownError;
      },
    );
    const onTeardownError = vi.fn();

    pool.get();
    await pool.discard(onTeardownError);

    expect(onTeardownError).toHaveBeenCalledWith(teardownError);
  });

  it('discarding twice in a row is safe and only tears down once', async () => {
    const teardown = vi.fn(async () => {});
    const pool = new PooledConnection(() => ({ id: 1 }), teardown);

    pool.get();
    await pool.discard();
    await pool.discard();

    expect(teardown).toHaveBeenCalledTimes(1);
  });
});
