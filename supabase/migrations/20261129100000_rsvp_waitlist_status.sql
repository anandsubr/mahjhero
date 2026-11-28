/*
 * Mahj Night planner (pivot batch 2b): a yes that arrives once every seat is
 * taken now joins a waitlist instead of being refused. Its own migration
 * because a new enum value can't be used in the transaction that adds it.
 */
alter type public.rsvp_status add value if not exists 'waitlist';
