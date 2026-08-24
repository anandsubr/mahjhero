import { renderMessage } from './render.ts';
import type { Sender } from './sender.ts';
import type { RenderRow } from './types.ts';

/**
 * How the loop tells the queue what happened. An interface rather than the
 * Supabase client itself, so the loop can be tested without a database.
 */
export type Report = {
  markSent(ids: string[]): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
};

/**
 * Sequential, not concurrent.
 *
 * Fifty messages a minute is three thousand an hour, far beyond what a
 * club-scale product produces, and sending one at a time keeps a shared
 * relay from rate-limiting the whole batch because of one burst. There is
 * no latency problem here worth solving with concurrency.
 *
 * One message failing must not cost the rest their delivery window, so
 * every send is individually guarded — including the render, which can
 * throw on a payload shaped differently from what its kind expects.
 */
export async function deliverBatch(
  rows: RenderRow[],
  sender: Sender,
  appUrl: string,
  report: Report,
): Promise<{ sent: number; failed: number }> {
  const sentIds: string[] = [];
  let failed = 0;

  for (const row of rows) {
    try {
      await sender.send(renderMessage(row, appUrl));
      sentIds.push(row.id);
    } catch (cause) {
      failed += 1;
      // Reported one at a time, because each failure has its own reason and
      // the reason is the only thing a human reading the table later has.
      await report.markFailed(row.id, cause instanceof Error ? cause.message : String(cause));
    }
  }

  // One call for the whole batch, and skipped entirely when nothing went —
  // marking an empty array is a wasted round trip on every quiet minute,
  // which is most of them.
  if (sentIds.length > 0) await report.markSent(sentIds);

  return { sent: sentIds.length, failed };
}
