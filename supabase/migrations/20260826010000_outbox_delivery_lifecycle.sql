/*
 * Plan 4 built the outbox and never read one row back. `sent_at` has been
 * on the table since the day it was created with nothing writing to it.
 * These five columns turn it from a queue into a queue with a memory: what
 * has been tried, when it may be tried again, why it last failed, and
 * which of the three terminal states it reached.
 *
 * There is no separate notification_log table. The parent spec requires
 * every send to be logged and deduped; `dedupe_key` was already the dedupe,
 * and these columns are the log. A second table would hold the same facts
 * keyed the same way.
 */
alter table public.notification_outbox
  -- Incremented at CLAIM, not at send. The Edge Function sends after the
  -- claim transaction commits, so nothing can hold a row lock across the
  -- send; the increment is what bounds the work when a function dies
  -- mid-batch and the row becomes due again.
  add column attempts        int         not null default 0,
  -- Due time. The five-minute claim lease, the exponential backoff, and a
  -- quiet-hours hold all express themselves through this one column.
  add column next_attempt_at timestamptz not null default now(),
  add column last_error      text,
  add column failed_at       timestamptz,
  add column expired_at      timestamptz;

/*
 * Exactly one terminal state, or none. Three nullable timestamps with no
 * constraint would let a confused retry mark a row both sent and failed,
 * and then nobody can answer "what happened to this message" from the row
 * itself — which is the entire reason the columns are on the row rather
 * than in a side table.
 */
alter table public.notification_outbox
  add constraint notification_outbox_one_terminal_state check (
      (case when sent_at    is not null then 1 else 0 end)
    + (case when failed_at  is not null then 1 else 0 end)
    + (case when expired_at is not null then 1 else 0 end)
    <= 1
  );

/*
 * Partial, because the claim query only ever asks for live rows and the
 * table is append-only — every message ever sent stays in it forever. A
 * full index would grow without bound while the interesting set stays
 * small. Ordered to match the claim's `order by` exactly, so a backlog
 * drains oldest-due-first without a sort.
 */
create index notification_outbox_due
  on public.notification_outbox (next_attempt_at, created_at)
  where sent_at is null and failed_at is null and expired_at is null;
