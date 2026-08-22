# Database tests

Two directories, split by **where a test is able to run** — not by what it
tests. Put a new file in the right one and the tooling does the rest.

| Directory   | Runs against            | Command                  |
| ----------- | ----------------------- | ------------------------ |
| `portable/` | local **and** hosted    | `npm run test:db:remote` |
| `fixtures/` | local only              | `npm run test:db`        |

`npm run test:db` runs everything locally; the CLI recurses, so both
directories are covered.

## Why the split exists

`supabase test db --linked` connects as `cli_login_postgres`, a role the CLI
provisions for the run. That role **cannot write to the `auth` schema** on a
hosted project:

```
ERROR:  permission denied for schema auth
LINE 1: insert into auth.users (id, email) values
```

Every test that needs a signed-in member creates one by inserting into
`auth.users` — there is no SQL-level alternative, because hosted Supabase
reserves that schema. Locally the CLI connects with far more privilege, so the
same file runs fine.

**We do not fix this with a grant.** Migrations are forward-only and apply to
every environment, so a migration granting a login role `INSERT` on
`auth.users` would ship to production the day that project is created. Test
convenience is not worth a writable path into the real user table.

So: tests that need fixture users live in `fixtures/` and run locally.
Everything else lives in `portable/` and runs in both places.

## Why running against hosted matters at all

It would be easy to read the split as "local is the real suite, hosted is a
bonus". It is closer to the opposite for the files that can run there.

`portable/grants.test.sql` asserts privileges — who may `TRUNCATE`, who may
`INSERT`, which functions `anon` can execute. Those are exactly the things
that **drift on hosted and cannot drift locally**, because they come from
Supabase's own bootstrap rather than from our migrations:

- `alter default privileges in schema public grant all on tables to authenticated`
  is why every table here was silently granted `TRUNCATE`, which bypasses RLS
  entirely. Every RLS test passed the whole time that hole was open.
- Supabase grants `EXECUTE` directly to `anon`, `authenticated` and
  `service_role` on new functions, so `revoke ... from public` only half-works.
- Dashboard changes and extension installs alter grants with no migration.

Policy *logic* is identical in both databases because it comes from the same
migration files. Privilege *state* is not. Running `portable/` against the
linked project is the only check that sees the difference.

## Getting pgTAP to resolve

Two things were needed, and both are easy to misdiagnose:

1. pgTAP lives in the `extensions` schema. Supabase forces it there —
   `create extension ... with schema public` does not relocate an extension
   that already exists. So every test file starts with
   `set local search_path to extensions, public;`.
2. `cli_login_postgres` had no `USAGE` on `extensions`, granted in
   `20260822190000_grant_extensions_usage_for_pgtap.sql`.

Without (2), every file failed with `function plan(integer) does not exist` —
which reads as "pgTAP is not installed" and is why an earlier attempt
concluded that testing a linked project was impossible. pgTAP was installed
the whole time; it was unreachable. **A missing schema privilege reports as a
missing function, never as a permission error.**

## CI

`portable/` is not wired into CI yet. Doing so needs `SUPABASE_ACCESS_TOKEN`
and the project ref as secrets, and a decision about which project a CI run
should point at — a pull request should not be gating on the same database the
app is using.
