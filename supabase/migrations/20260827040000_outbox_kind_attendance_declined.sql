/*
 * One new kind, alone in its own migration.
 *
 * `alter type ... add value` cannot be used by any statement in the same
 * transaction that adds it, and each migration file is one transaction.
 * The next migration references this label, so it has to arrive first and
 * by itself. This file does nothing else on purpose -- exactly the shape
 * 20260826000000 has for plan 6's two kinds.
 *
 * `if not exists` because migrations are forward-only and `db reset`
 * replays them all.
 */
alter type public.outbox_kind
  add value if not exists 'attendance_declined';
