/*
 * The last function in this schema still carrying PostgreSQL's default
 * EXECUTE-to-PUBLIC grant. `handle_new_user` predates every migration that
 * tightened the others (it ships with `20260801221252_create_profiles.sql`),
 * so it was missed by both 20260822045809 and 20260822180200.
 *
 * Verified live before this migration:
 *
 *   proname          | anon_x
 *   handle_new_user  | t
 *
 * Calling it directly does nothing useful — plpgsql raises "trigger functions
 * can only be called as triggers" when `TG_OP` is absent — so this is an ACL
 * correction, not a live hole. It is here because the grants test now asserts
 * that *no* function in `public` is executable by `anon`, and a blanket
 * assertion is the only thing that can catch the next definer function
 * somebody adds without thinking about its ACL. That assertion is worth more
 * than this one function, and it cannot be written while an exception exists.
 */
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon, authenticated;
