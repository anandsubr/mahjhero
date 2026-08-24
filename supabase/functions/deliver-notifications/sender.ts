import type { Message } from './types.ts';

/**
 * One method, so a test can substitute a recorder and so the later push
 * plan adds an implementation rather than an `if` in the batch loop.
 *
 * Deliberately free of Deno imports: Vitest resolves this file, and
 * everything that touches a socket lives in smtp.ts instead.
 */
export interface Sender {
  send(message: Message): Promise<void>;
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
