/*
 * Two new kinds, alone in their own migration.
 *
 * `alter type ... add value` cannot be used by any statement in the same
 * transaction that adds it, and each migration file is one transaction.
 * Every migration below this one references both labels, so they have to
 * arrive first and by themselves. This file does nothing else on purpose.
 *
 * `if not exists` because migrations are forward-only and `db reset`
 * replays them all — the same guard 20260825060000 uses around
 * `cron.unschedule`.
 */
alter type public.outbox_kind add value if not exists 'event_reminder';
alter type public.outbox_kind add value if not exists 'broadcast';
