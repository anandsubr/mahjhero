/*
 * Corrective migration for two things 20260822045809 got wrong.
 *
 * 1. Its closing comment claims:
 *
 *      "service_role is left alone: every table grant in this schema already
 *       gives service_role full access by design"
 *
 *    That is false, and it is the kind of false that costs a day. Verified
 *    live on both local and hosted, `select relacl from pg_class`:
 *
 *      profiles     | {postgres=arwdDxtm/postgres,service_role=Dxtm/postgres,...}
 *      clubs        | {postgres=arwdDxtm/postgres,service_role=Dxtm/postgres,...}
 *      club_members | {postgres=arwdDxtm/postgres,service_role=Dxtm/postgres,...}
 *      club_invites | {postgres=arwdDxtm/postgres,service_role=Dxtm/postgres,...}
 *
 *    `Dxtm` is TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. There is no `a`, `r`,
 *    `w` or `d` — no INSERT, SELECT, UPDATE or DELETE anywhere. service_role
 *    has BYPASSRLS, which skips *policies*; it does not skip *grants*, and
 *    the two are independent gates. So the first Edge Function the
 *    notifications plan writes gets `permission denied for table profiles`,
 *    and whoever debugs it reads that comment, concludes grants are fine, and
 *    goes looking at RLS instead.
 *
 *    (This is a side effect of 20260822041836's `revoke all ... from anon,
 *    authenticated` plus Supabase's bootstrap default privileges, which grant
 *    service_role only the non-DML verbs on tables created after them.)
 *
 * 2. Its anon-EXECUTE revoke was applied to `accept_club_invite` only, but
 *    all three functions in this schema were created the same way and carry
 *    the same default. Verified live, `select proacl from pg_proc`:
 *
 *      is_club_member | (null)                    -- null ACL == EXECUTE to PUBLIC
 *      create_club    | {=X/postgres,postgres=X/postgres,authenticated=X/postgres}
 *
 *    The leading `=X` is the PUBLIC grant. Both are guarded and harmless
 *    today — `create_club` raises 42501 when `auth.uid()` is null, and
 *    `is_club_member` returns false — but "harmless because the body checks"
 *    is one refactor away from "exploitable", and an ACL that does not say
 *    what it means is a trap for the next reader.
 */

-- The DML verbs, on the tables that exist. service_role is the trusted
-- backend identity, never handed to an end user; it is the role Edge
-- Functions and scheduled jobs run as.
grant select, insert, update, delete on public.profiles     to service_role;
grant select, insert, update, delete on public.clubs        to service_role;
grant select, insert, update, delete on public.club_members to service_role;
grant select, insert, update, delete on public.club_invites to service_role;

-- And on the tables that do not exist yet, so the next `create table` in this
-- schema does not reopen the same gap. Mirrors the defensive
-- `alter default privileges ... revoke` for anon/authenticated at the end of
-- 20260822041836.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

-- The two functions 20260822045809 missed. `from public` clears the implicit
-- PostgreSQL default; `from anon` clears the direct grant Supabase's hosted
-- bootstrap adds, which `from public` does not touch.
revoke execute on function public.create_club(text, text) from public;
revoke execute on function public.create_club(text, text) from anon;
grant  execute on function public.create_club(text, text) to authenticated;

-- is_club_member is called from inside RLS policies on clubs and
-- club_members, which are evaluated as the querying role, so `authenticated`
-- genuinely needs EXECUTE here — this is not decorative.
revoke execute on function public.is_club_member(uuid) from public;
revoke execute on function public.is_club_member(uuid) from anon;
grant  execute on function public.is_club_member(uuid) to authenticated;
