/**
 * This app session's own record of games it has marked seen
 * (`markEventSeen`), so a game list that reloads before the
 * `mark_event_seen` RPC lands doesn't show the "Updated" pill once more.
 *
 * In memory only, per app session. The rule: a list request that STARTED
 * before this session's mark settled can't reflect that mark, so its
 * `updated` is trusted to the local record (forced false). A request started
 * after the mark settled reflects the server, so its answer stands -- which
 * is what lets a later host edit bring the pill back.
 */
type Entry = { settledAt: number | null };

const seen = new Map<string, Entry>();

/** Called before the RPC is sent. */
export function noteSeenStarted(eventId: string): void {
  seen.set(eventId, { settledAt: null });
}

/** Called once the RPC has answered. A failed mark is forgotten. */
export function noteSeenSettled(eventId: string, ok: boolean): void {
  const entry = seen.get(eventId);
  if (!entry) return;
  if (ok) entry.settledAt = Date.now();
  else seen.delete(eventId);
}

/**
 * Whether a row's server `updated` should be dropped: this session marked
 * the game seen, and the list request began before that mark settled.
 */
export function seenLocally(eventId: string, requestStartedAt: number): boolean {
  const entry = seen.get(eventId);
  if (!entry) return false;
  return entry.settledAt === null || requestStartedAt < entry.settledAt;
}

/** Tests only. */
export function resetSeenEvents(): void {
  seen.clear();
}
