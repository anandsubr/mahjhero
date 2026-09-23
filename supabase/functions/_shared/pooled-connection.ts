/**
 * The reuse/teardown state machine `SmtpSender` (smtp.ts) composes to avoid
 * reusing a connection a failed send may have left in a bad state.
 *
 * Pulled out of smtp.ts, which is the one file in this function that
 * imports a Deno URL module (`denomailer`) and is therefore invisible to
 * Vitest (see its own docstring). The state this class owns — do I have a
 * live client, hand it out, throw it away the moment something on it
 * fails — has nothing to do with SMTP or denomailer at all, so it lives
 * here, generic over whatever client type the caller supplies, with no
 * import of its own. That is what lets it be unit-tested directly, unlike
 * the class that composes it.
 */
export class PooledConnection<T> {
  private client: T | null = null;

  constructor(
    /** Creates a new client. Called on first use, and again after `discard`. */
    private readonly open: () => T,
    /** Tears a client down. Never called concurrently with itself. */
    private readonly teardown: (client: T) => Promise<void>,
  ) {}

  /**
   * The live client, opening one via `open` if none exists yet. Reused on
   * every call until `discard` runs.
   */
  get(): T {
    if (this.client === null) {
      this.client = this.open();
    }
    return this.client;
  }

  /**
   * Discards the current client, if there is one, so the next `get()`
   * opens a fresh one instead of handing back something a failure may have
   * left in an inconsistent state. Idempotent — calling this with no live
   * client is a no-op.
   *
   * `teardown` failing does not propagate: by the time this runs, the
   * caller is already unwinding from a real failure (a failed send, or the
   * batch simply ending), and the underlying resource may already be
   * closed on its own — a `teardown` throwing on top of that must never
   * mask or replace the error the caller is already handling.
   *
   * `onTeardownError`, if given, is called with whatever `teardown` threw.
   * Optional so a caller that has nothing meaningful to do with a teardown
   * failure (this class's own docstring is proof enough that discarding a
   * possibly-already-dead client can fail harmlessly) is not forced to
   * pass a no-op.
   */
  async discard(onTeardownError?: (error: unknown) => void): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client === null) return;
    try {
      await this.teardown(client);
    } catch (error) {
      onTeardownError?.(error);
    }
  }
}
