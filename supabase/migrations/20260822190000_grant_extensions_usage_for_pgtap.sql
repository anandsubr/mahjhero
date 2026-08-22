/*
 * Lets the database test suite run against the hosted project, not just local.
 *
 * `supabase test db --linked` connects as `cli_login_postgres`, a role the CLI
 * provisions for the run. pgTAP lives in the `extensions` schema — Supabase
 * forces extensions there and `create extension ... with schema public` does
 * not relocate one that already exists. That role had no USAGE on
 * `extensions`, so every test file failed with
 *
 *   ERROR: function plan(integer) does not exist
 *
 * which reads as "pgTAP is not installed" and is why an earlier attempt
 * concluded, wrongly, that testing against a linked project was structurally
 * impossible. pgTAP was installed the whole time; it was unreachable.
 *
 * A missing schema privilege reports as a missing function, never as a
 * permission error. That is the trap.
 *
 * 20260801210849_grant_pgtap_usage.sql was meant to be this migration and is a
 * zero-byte file — it never ran. Amending it would do nothing: the CLI tracks
 * migrations by version timestamp, not content, so an applied timestamp is
 * silently skipped. Hence a new forward migration, per this project's rule.
 *
 * Granted to PUBLIC rather than to `cli_login_postgres`, because that role is
 * provisioned per run and a grant to it would not survive.
 *
 * On exposure: `anon`, `authenticated` and `service_role` already hold USAGE on
 * this schema from Supabase's own bootstrap — `anon` being the least
 * privileged role in the system. Extending it to PUBLIC therefore grants no
 * reach that the anonymous role did not already have. USAGE only permits
 * *referencing* objects in the schema; EXECUTE on individual functions is a
 * separate gate, and the tenant boundary lives in RLS policies and table
 * grants, neither of which this touches.
 */

grant usage on schema extensions to public;
