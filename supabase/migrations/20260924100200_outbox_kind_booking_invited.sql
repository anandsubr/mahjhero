/*
 * One new kind, alone in its own migration -- same shape as
 * 20260827040000. `alter type ... add value` cannot be used by any
 * statement in the same transaction that adds it, and each migration file
 * is one transaction. `if not exists` because db reset replays everything.
 * Written by commit_booking (20260924102000) to each invitee.
 */
alter type public.outbox_kind
  add value if not exists 'booking_invited';
