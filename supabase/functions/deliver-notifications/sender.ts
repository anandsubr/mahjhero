import type { Message } from './types.ts';

/**
 * One required method, so a test can substitute a recorder and so the
 * later push plan adds an implementation rather than an `if` in the batch
 * loop.
 *
 * Deliberately free of Deno imports: Vitest resolves this file, and
 * everything that touches a socket lives in smtp.ts instead.
 */
export interface Sender {
  send(message: Message): Promise<void>;

  /**
   * Release whatever `send` accumulated — a `SmtpSender` holds one SMTP
   * connection open across every `send` call in a batch (see smtp.ts) so a
   * relay is not asked for a fresh TCP+TLS handshake per message, and this
   * is where that connection gets closed. `deliverBatch` calls it exactly
   * once, after the loop ends, in a `finally` — however the loop ended:
   * every row sent, a row rejected, or an early break on a connection-class
   * failure.
   *
   * Optional because not every `Sender` holds a resource worth closing —
   * `FakeSender` below has nothing to release, so it does not implement
   * this rather than shipping a no-op override.
   */
  close?(): Promise<void>;
}

export class FakeSender implements Sender {
  readonly sent: Message[] = [];

  /**
   * @param failOn returns a failure reason for messages that should be
   *   rejected, or null to accept. Lets a test drive the retry path
   *   without a mail server that can be made to misbehave on cue.
   */
  constructor(private readonly failOn: (message: Message) => string | null = () => null) {}

  send(message: Message): Promise<void> {
    const reason = this.failOn(message);
    // Recorded only on success, so `sent` means sent.
    if (reason) return Promise.reject(new Error(reason));
    this.sent.push(message);
    return Promise.resolve();
  }
}
