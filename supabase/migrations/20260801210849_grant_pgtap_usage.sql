/*
 * Intentionally empty. Do not fill this in.
 *
 * This file was meant to grant USAGE on the `extensions` schema so the pgTAP
 * test runner could resolve `plan()`. It was committed at zero bytes, so it
 * never did anything — which is why the grant appeared "not to stick" and why
 * running tests against a linked project was written off as impossible.
 *
 * It is recorded as applied in the remote migration history. `supabase db push`
 * tracks migrations by version timestamp, not by content hash, so writing the
 * grant here now would be silently skipped on every environment that has
 * already seen this timestamp — while reporting success. That failure mode is
 * the reason this comment exists rather than the SQL.
 *
 * The grant lives in 20260822190000_grant_extensions_usage_for_pgtap.sql.
 *
 * Only a comment is added here: comments execute nothing, so local replay and
 * hosted state stay identical. Anything executable would diverge them.
 */
