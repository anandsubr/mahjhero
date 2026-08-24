/*
 * A one-time backfill, not a change to how new rows behave — that behaviour
 * lives in 20260826010000 and 20260826040000/20260826060000's staleness
 * horizon and is correct as written. This closes a gap those migrations
 * left: `next_attempt_at` got `default now()` for rows that already
 * existed, so plan 4's weeks of pre-lifecycle backlog came due the instant
 * this branch deploys — but `outbox_expires_at` only retires an event-bound
 * row once its event's `starts_at` has passed. A row queued in early August
 * for an occurrence that hasn't happened yet — say a `promotion_offer` for
 * an event on 2026-09-01, whose own two-hour fuse (`promotion_offers.
 * expires_at`) lapsed weeks ago — survives both sweeps and goes out on the
 * first tick, "held for you for the next two hours," about an offer nobody
 * has been able to accept in weeks.
 *
 * "Pre-existing" is identified without a hardcoded cutoff timestamp: this
 * statement runs exactly once, when this migration is applied, and every
 * row already sitting in `notification_outbox` at that moment — whatever
 * moment that turns out to be on whichever environment applies it — is by
 * definition backlog from before this deploy. A literal date here would be
 * a guess about when `supabase db push` actually runs; asking "does this
 * row already exist right now, this instant" needs no guess and is exactly
 * the question the bug is about.
 *
 * Consequences of that:
 *   - On a fresh `db reset` or a brand-new environment, `notification_outbox`
 *     is empty when this migration runs (nothing has been queued yet, since
 *     migrations run before any seed or test fixture inserts a row), so this
 *     is a no-op there — exactly what a from-scratch database should get.
 *   - On the environment that actually carries plan 4's backlog, every row
 *     still pending when this migration is applied is expired here, once,
 *     regardless of what event it points at or whether that event is still
 *     in the future.
 *   - Anything inserted by producers running *after* this migration is
 *     unaffected — it did not exist yet when the statement ran — and is
 *     governed by the ordinary staleness horizon from here on, same as
 *     always.
 *
 * Only rows still pending are touched. A row already sent, failed, or
 * expired by the time this runs keeps whatever terminal state it already
 * reached — `notification_outbox_one_terminal_state` would refuse to set a
 * second one anyway.
 *
 * That "every row still pending right now is backlog" premise is only true
 * the FIRST time this migration is applied to a database that already
 * carries plan 4's pre-drain rows. It stops being true the moment this
 * branch has been deployed once and the drain has been running against it:
 * on a staging box that already has this migration applied and
 * `app_config` seeded, a second `supabase db push` — or a manual re-run
 * during a rebase or a migration-history repair — would expire whatever is
 * legitimately queued and pending *right then*, not a stale backlog at
 * all. Migrations in this project are not expected to be re-applied to a
 * database that already has them, and this one is written on that same
 * assumption; it is called out here because the cost of getting it wrong
 * on this particular migration is silent, live message loss, not an error.
 */
update public.notification_outbox
   set expired_at = now(),
       last_error = 'expired: pre-existing backlog cleared before the drain went live'
 where sent_at is null
   and failed_at is null
   and expired_at is null;
