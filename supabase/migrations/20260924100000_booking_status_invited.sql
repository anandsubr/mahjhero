/*
 * Game invites (docs/superpowers/specs/2026-09-24-game-invites-accept-decline-design.md):
 * a booking can be pending the invitee's answer.
 *
 * Alone in its own migration, like 20260826000000's outbox kinds:
 * `alter type ... add value` cannot be used by any statement in the same
 * transaction that adds it, and each migration file is one transaction.
 * The column, check constraints and index that reference 'invited' come in
 * the next file. `if not exists` because `db reset` replays everything.
 * `after 'waitlisted'` only so the enum reads in the spec's order; nothing
 * orders by booking_status.
 */
alter type public.booking_status add value if not exists 'invited' after 'waitlisted';
