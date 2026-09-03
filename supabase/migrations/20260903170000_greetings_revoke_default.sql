/*
 * Every table-creating migration since 20260826020000_push_tokens.sql opens
 * with a defensive `revoke all ... from anon, authenticated` before its own
 * grants -- Supabase grants ALL on every new table in `public` to
 * `authenticated` by default, and ALL includes TRUNCATE, which is not
 * subject to row-level security. 20260903090000_create_greetings.sql is the
 * one new table in this branch that skipped it. Restated here rather than
 * hand-editing that already-applied migration, per this project's
 * forward-only rule.
 *
 * The grant below restates 20260903090000's own existing grant exactly --
 * this migration narrows nothing, it just adds the missing revoke ahead of
 * it.
 */
revoke all on public.greetings from anon, authenticated;
grant select, insert, update, delete on public.greetings to authenticated;
