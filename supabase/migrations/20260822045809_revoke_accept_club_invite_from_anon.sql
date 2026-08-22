/*
 * Corrective migration. The previous migration's
 * `revoke execute ... from public` was written assuming EXECUTE had only
 * been granted to the PUBLIC pseudo-role, matching what the local stack
 * actually shows: `select proacl from pg_proc where proname =
 * 'accept_club_invite'` gives `{postgres=X/postgres,authenticated=X/postgres}`
 * locally.
 *
 * The hosted project bootstraps every new function with EXECUTE granted
 * directly to anon, authenticated, and service_role (not through PUBLIC) —
 * confirmed with the same query against hosted:
 * `{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
 * `revoke ... from public` does not touch a direct grant, so on hosted
 * `anon` could still call this function after that migration ran (verified
 * live: `has_function_privilege('anon', 'public.accept_club_invite(text)',
 * 'EXECUTE')` returned true post-push). Still harmless in practice — the
 * function's own `caller is null` guard returns null for an unauthenticated
 * caller — but the ACL should say what it means.
 *
 * service_role is left alone: every table grant in this schema already
 * gives service_role full access by design (it is the trusted backend
 * client, never exposed to end users), so this function is no different.
 */
revoke execute on function public.accept_club_invite(text) from anon;
