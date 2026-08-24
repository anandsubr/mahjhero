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
  /**
   * Called instead of `markFailed` whenever the loop breaks — a recognized
   * connection-class failure, a recognized transient 4xx reply, or the
   * unrecognized-failure streak backstop (see the checks below).
   *
   * `spared` is every row this tick claimed but never even attempted:
   * whatever is left of `rows` after the one that triggered the break.
   * They are refunded outright — the claim already burned an attempt on
   * each of them (see `claim_notification_batch`) for work that never
   * happened at all.
   *
   * `trigger` is the row that actually threw the error the break is
   * responding to, together with that error. It is refunded too, most of
   * the time — but tracked separately from `spared`, because it is the row
   * that keeps leading every subsequent batch if whatever is producing
   * that error keeps producing it. `release_notification_claims`
   * (20260826110000) is what gives that row a bounded number of free
   * passes before treating it as its own problem rather than the relay's,
   * so an outage can't wedge the queue on one row forever.
   */
  release(spared: string[], trigger: { id: string; error: string }): Promise<void>;
};

/**
 * The 3-digit SMTP reply code a failure message starts with, or null if it
 * doesn't have that shape at all.
 *
 * denomailer (1.6.0, `client/basic/client.ts`'s `connection.ts`
 * `assertCode`, read directly from source) turns every non-matching SMTP
 * reply into `new Error(code + ": " + args)` — a message that starts with
 * the three-digit reply code. That shape can only exist once a connection
 * succeeded and the server itself spoke back, which is exactly the
 * distinction `looksLikeAddressRejection` and `looksLikeTransientReply`
 * below both rely on.
 */
function replyCode(message: string): number | null {
  const match = /^(\d{3})[:\s]/.exec(message);
  return match ? Number(match[1]) : null;
}

/**
 * A permanent rejection — SMTP's 5xx class — of this specific address:
 * the server saw the exchange and said no, and saying it again later
 * changes nothing. This row's problem, not the relay's: burns an attempt
 * and the loop keeps going.
 */
function looksLikeAddressRejection(message: string): boolean {
  const code = replyCode(message);
  return code !== null && code >= 500 && code < 600;
}

/**
 * A temporary rejection — SMTP's 4xx class — of this exchange, right now.
 * Per RFC 5321, 4xx means "try again later, nothing about this is
 * permanent," at any stage: a greylist on `RCPT TO`, `421 Too many
 * concurrent connections` on connect, `451 Temporary local problem`
 * mid-transaction. A relay under load or throttling this batch answers
 * every row this way — the same shape the original blocker had, just with
 * a reply code instead of a dropped connection — so this is treated like a
 * connection failure below: the loop breaks rather than burning an
 * attempt on a row that was never actually wrong.
 */
function looksLikeTransientReply(message: string): boolean {
  const code = replyCode(message);
  return code !== null && code >= 400 && code < 500;
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
 *
 * Every alternative is wrapped in `\b...\b`: `dns` and `not connected` are
 * short enough to occur as substrings of something that has nothing to do
 * with a connection failure at all — a denomailer validation error naming
 * an address like `dnsadmin@club.example` contains `dns` with no word
 * boundary on either side of it, so `\bdns\b` correctly does not match it,
 * while it still matches a genuine standalone "DNS resolution failed".
 * Without the boundary, that one address would have `break`d every batch
 * it led forever — see `release_notification_claims`'s escape hatch below
 * for the backstop against a row that manages this some other way.
 */
function looksLikeConnectionFailure(message: string): boolean {
  return /\b(connection refused|connection reset|connection aborted|broken pipe|not connected|network (?:is )?unreachable|host (?:is )?unreachable|timed? ?out|dns|lookup address|name or service not known|connection is not secure|unexpected eof|econnrefused|econnreset|etimedout|enotfound|ehostunreach|enetunreach)\b/i.test(
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
 * that row (or any row after it) is marked failed, and `report.release`
 * refunds the attempt the claim already burned on every one of them,
 * including the row that tipped the streak. So the true cost of a real
 * outage is bounded by this number of rows, once, not by the batch size
 * repeated on every tick it lasts.
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
 * - Sending can throw for one of three reasons, each handled differently:
 *   the address was permanently rejected — 5xx, this row's problem, same
 *   treatment as a render failure; the reply was a transient 4xx, or the
 *   failure looks like the relay itself (nobody's fault this tick, and
 *   every row still waiting behind it would fail the exact same way for
 *   the exact same reason); or the failure matches neither pattern, which
 *   is handled by the streak backstop below. A relay outage that ran for
 *   the whole five-attempt backoff schedule used to dead-letter every row
 *   queued when it started, silently, because the old version of this loop
 *   could not tell address rejections and relay trouble apart and burned
 *   an attempt on both alike. See `looksLikeAddressRejection`,
 *   `looksLikeTransientReply` and `looksLikeConnectionFailure` above for
 *   how it tells them apart now, and `RELAY_DOWN_STREAK` for what happens
 *   when none of them recognize a failure at all.
 *
 * Breaking the loop does not, on its own, spare a row's attempt —
 * `claim_notification_batch` already burned one on every row the moment it
 * claimed them, before any of this ran. `report.release` is what actually
 * refunds that: called once, right before the `break`, with every row this
 * tick claimed but never even tried (`spared`) and the one row whose own
 * `send` produced the error the batch is stopping for (`trigger`). See its
 * doc comment above and `release_notification_claims`'s for what happens
 * to each.
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
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let message: Message;
      try {
        message = renderMessage(row, appUrl);
      } catch (cause) {
        // A render failure says nothing about the relay's health — it
        // never touched the network — so it must not feed the streak
        // below. Previously this reset it to 0, which is a stronger claim
        // than "does not count": a run of genuinely unrecognized send
        // failures with a render failure interleaved among them would
        // never reach RELAY_DOWN_STREAK, because the reset erased whatever
        // progress toward it those send failures had already made. Simply
        // not touching the counter is what "does not count toward the
        // streak" actually means.
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
        const spared = rows.slice(i + 1).map((r) => r.id);

        if (looksLikeAddressRejection(errorMessage)) {
          unexplainedStreak = 0;
          failed += 1;
          await report.markFailed(row.id, errorMessage);
          continue;
        }

        if (looksLikeConnectionFailure(errorMessage)) {
          // Recognized outright: the relay, not this row.
          console.error(
            `deliver-notifications: batch stopped at row ${row.id} — looks like the relay itself, not this address: ${errorMessage}`,
          );
          await report.release(spared, { id: row.id, error: errorMessage });
          break;
        }

        if (looksLikeTransientReply(errorMessage)) {
          // A 4xx reply: also not this row's fault, and also not worth
          // continuing past — see looksLikeTransientReply's doc comment
          // for why a 4xx storm is the same blocker as a dead relay.
          console.error(
            `deliver-notifications: batch stopped at row ${row.id} — a transient 4xx reply, not a permanent rejection: ${errorMessage}`,
          );
          await report.release(spared, { id: row.id, error: errorMessage });
          break;
        }

        unexplainedStreak += 1;
        if (unexplainedStreak >= RELAY_DOWN_STREAK) {
          // Not recognized, but this is the third in a row with no
          // success in between — treated as the relay from here, the same
          // as an outright match above.
          console.error(
            `deliver-notifications: batch stopped at row ${row.id} — ${RELAY_DOWN_STREAK} consecutive unrecognized failures, treating as the relay: ${errorMessage}`,
          );
          await report.release(spared, { id: row.id, error: errorMessage });
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
