/*
 * Removes privileges no policy ever intended to give.
 *
 * Supabase bootstraps every project with
 *
 *   alter default privileges in schema public grant all on tables to authenticated;
 *
 * so every table created here is granted ALL to `authenticated` automatically.
 * A later `grant select, ...` does not narrow that — grants are additive, so
 * the explicit grants in earlier migrations were decorative while ALL was
 * already in force underneath.
 *
 * ALL includes TRUNCATE, and **TRUNCATE is not subject to row-level
 * security**. Policies filter rows; TRUNCATE empties the table without
 * consulting them. Any signed-in member could therefore have run
 *
 *   truncate table public.profiles cascade;
 *
 * and wiped every profile in the system, taking club memberships with it via
 * the cascade — regardless of how carefully the policies were written.
 *
 * ALL also includes REFERENCES and TRIGGER, which let a client attach foreign
 * keys and triggers to these tables. Neither is anything the app needs.
 *
 * So: revoke everything explicitly, then grant back exactly what each table's
 * policies are written to filter, and nothing else. `anon` is revoked too —
 * no table here has an anon policy, so anon should reach none of them.
 */

revoke all on public.profiles      from anon, authenticated;
revoke all on public.clubs         from anon, authenticated;
revoke all on public.club_members  from anon, authenticated;
revoke all on public.club_invites  from anon, authenticated;

-- Matched to the policies that exist, verb for verb.
--   profiles:     select own/co-member, update own
--   clubs:        select as member, update as host
--   club_members: select as member (writes go through definer functions only)
--   club_invites: select and insert as organizer
grant select, update on public.profiles     to authenticated;
grant select, update on public.clubs        to authenticated;
grant select         on public.club_members to authenticated;
grant select, insert on public.club_invites to authenticated;

-- Stop the same thing happening to every table added from here on. Without
-- this, the next `create table` in this schema is granted ALL again and the
-- hole silently reopens.
alter default privileges in schema public revoke all on tables from anon, authenticated;
