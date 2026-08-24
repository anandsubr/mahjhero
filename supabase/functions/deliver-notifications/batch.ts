import { renderMessage } from './render.ts';
import type { Sender } from './sender.ts';
import type { Message, RenderRow } from './types.ts';

/**
 * How the loop tells the queue what happened. An interface rather than the
 * Supabase client itself, so the loop can be tested without a database.
 */
export type Report = {
  markSent(ids: string[]): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
};

/**
 * A rejection that only ever comes from the SMTP server itself, after a
 * full connection and protocol exchange already happened — this address's
 * problem, not the relay's.
 *
 * denomailer (1.6.0, `client/basic/client.ts`'s `assertCode`) turns every
 * non-matching SMTP reply — a hard 550, a temporary 4xx greylist, anything
 * the server itself says no to — into `new Error(code + ": " + args)`: a
 * message that starts with the three-digit reply code. That shape can only
 * exist once a connection succeeded and the server spoke back, which is
 * exactly the distinction that matters here.
 */
function looksLikeAddressRejection(message: string): boolean {
  return /^\d{3}[:\s]/.test(message);
}

/**
 * A failure recognizable as the relay itself being unreachable, rather
 * than any particular address being rejected: Deno's own `Deno.connect` /
 * `Deno.connectTls` errors (connection refused, reset, timed out, DNS
 * resolution failure — confirmed against denomailer 1.6.0's source: it
 * calls those directly with no try/catch around the call, so the error
 * that comes back is Deno's own, unwrapped), denomailer's own
 * "Connection is not secure" handshake refusal, and the connect/send
 * timeout `smtp.ts` adds below (see `withTimeout`).
 *
 * denomailer does not export typed error classes to `instanceof` against
 * (confirmed against 1.6.0 — `assertCode` throws a bare `Error`, and so
 * does everything upstream of it), so this is necessarily a message-shape
 * check, not a type check. It is the most specific signal available, but
 * it cannot be complete — a wording change in a future denomailer release,
 * or a network failure that happens not to use any of these words, would
 * slip past it. `RELAY_DOWN_STREAK` below is the backstop for exactly that
 * gap.
 */
function looksLikeConnectionFailure(message: string): boolean {
  return /connection refused|connection reset|connection aborted|broken pipe|not connected|network (is )?unreachable|host (is )?unreachable|time(d)? ?out|dns|lookup address|name or service not known|connection is not secure|unexpected eof|econnrefused|econnreset|etimedout|enotfound|ehostunreach|enetunreach/i.test(
    message,
  );
}

/**
 * How many sends in a row must fail, none of them recognizable by either
 * check above, before this batch stops treating the run of failures as
 * coincidence and starts treating it as the relay. Three bad addresses in
 * a row, in a batch drawn from real recipients, is unlikely enough to be
 * worth trading against the alternative: fewer than three would let a
 * single oddly-worded rejection (denomailer wrapping something in a way
 * neither check above recognizes) abort a batch that was actually fine
 * address by address.
 *
 * This only ever costs an attempt on the rows *before* the streak is
 * recognized — by the time the count reaches this, the loop breaks before
 * that row (or any row after it) is marked failed, so the true cost of a
 * real outage is bounded by this number, not by the batch size.
 */
const RELAY_DOWN_STREAK = 3;

/**
 * Sequential, not concurrent.
 *
 * Fifty messages a minute is three thousand an hour, far beyond what a
 * club-scale product produces, and sending one at a time keeps a shared
 * relay from rate-limiting the whole batch because of one burst. There is
 * no latency problem here worth solving with concurrency.
 *
 * Two different things can make a row fail, and they are handled
 * differently:
 *
 * - Rendering can throw on a payload shaped differently from what its kind
 *   expects. That is always this row's problem — it happens before any
 *   network call — so it always costs this row an attempt and the loop
 *   keeps going.
 * - Sending can throw because the address was rejected (this row's
 *   problem, same treatment) or because the relay itself is unreachable
 *   (nobody's fault this tick, and every row still waiting behind it would
 *   fail the exact same way for the exact same reason). A relay outage
 *   that ran for the whole five-attempt backoff schedule used to
 *   dead-letter every row queued when it started, silently, because the
 *   old version of this loop could not tell the two apart and burned an
 *   attempt on both alike. See `looksLikeConnectionFailure` and
 *   `looksLikeAddressRejection` above for how it tells them apart now, and
 *   `RELAY_DOWN_STREAK` for what happens when it can't.
 */
export async function deliverBatch(
  rows: RenderRow[],
  sender: Sender,
  appUrl: string,
  report: Report,
): Promise<{ sent: number; failed: number }> {
  const sentIds: string[] = [];
  let failed = 0;
  let unexplainedStreak = 0;

  try {
    for (const row of rows) {
      let message: Message;
      try {
        message = renderMessage(row, appUrl);
      } catch (cause) {
        // A render failure says nothing about the relay's health — it
        // never touched the network — so it never counts toward the
        // streak below, and it always costs this row an attempt.
        unexplainedStreak = 0;
        failed += 1;
        await report.markFailed(row.id, cause instanceof Error ? cause.message : String(cause));
        continue;
      }

      try {
        await sender.send(message);
        sentIds.push(row.id);
        unexplainedStreak = 0;
        continue;
      } catch (cause) {
        const errorMessage = cause instanceof Error ? cause.message : String(cause);

        if (looksLikeAddressRejection(errorMessage)) {
          unexplainedStreak = 0;
          failed += 1;
          await report.markFailed(row.id, errorMessage);
          continue;
        }

        if (looksLikeConnectionFailure(errorMessage)) {
          // Recognized outright: the relay, not this row. Stop now, before
          // marking anything — this row keeps its attempt exactly like
          // every row still waiting behind it.
          break;
        }

        unexplainedStreak += 1;
        if (unexplainedStreak >= RELAY_DOWN_STREAK) {
          // Not recognized, but this is the third in a row with no
          // success in between — treated as the relay from here, the same
          // as an outright match above. This row is spared too; only the
          // `RELAY_DOWN_STREAK - 1` rows before it already paid for not
          // knowing sooner.
          break;
        }

        // Still ambiguous, and not yet a streak worth trusting. Treated
        // as this row's problem, same as an unrecognized render failure
        // would be.
        failed += 1;
        await report.markFailed(row.id, errorMessage);
      }
    }
  } finally {
    // Always, however the loop ended — every row sent, a row rejected, or
    // an early break above. A sender that reused one connection across the
    // batch (see smtp.ts) must not leak it because the loop stopped early.
    await sender.close?.();
  }

  // One call for the whole batch, and skipped entirely when nothing went —
  // marking an empty array is a wasted round trip on every quiet minute,
  // which is most of them.
  if (sentIds.length > 0) await report.markSent(sentIds);

  return { sent: sentIds.length, failed };
}
