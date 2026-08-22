/*
 * Keeps roughly six weeks of recurring events bookable.
 *
 * 03:00 UTC — deliberately not local-midnight-anything. The job is
 * idempotent and its window is measured in weeks, so the exact hour does not
 * matter; what matters is that it is nowhere near the evening when clubs are
 * actually playing and members are actually looking.
 *
 * `cron.unschedule` first, so re-running this migration against a project
 * that already has the job is not an error. Migrations are forward-only and
 * `db reset` replays them all.
 *
 * This runs as `postgres` — the role `db reset`/`db push` connect as, and
 * the owner of the `cron` schema — so it needs no grant on `cron` for either
 * environment. `cli_login_postgres`, the restricted role the hosted pgTAP
 * suite connects as, has no `USAGE` on `cron` at all (not fixed with a
 * grant — see docs/testing.md, "Scheduled work"), which is why the job's
 * existence is verified against local psql in this task rather than from
 * `portable/grants.test.sql`.
 */
do $$
begin
  perform cron.unschedule('materialize-event-series');
exception
  when others then
    -- No such job. Nothing to clean up.
    null;
end;
$$;

select cron.schedule(
  'materialize-event-series',
  '0 3 * * *',
  $$select public.materialize_event_series()$$
);

/*
 * Drift caught by the new authenticated-side catch-all in
 * portable/grants.test.sql, run against hosted before this migration was
 * written: `event_series_detach_occurrences` was reachable by
 * `authenticated` there, while local looked clean.
 *
 * 20260822195000 and 20260822196000 each revoked this trigger function only
 * `from public, anon` — never `authenticated` — unlike every other
 * trigger-only function in this schema (`clubs_freeze_identity`,
 * `handle_new_user`, `club_members_after_delete`, `clubs_validate_timezone`),
 * which all revoke from `authenticated` too. Local's `db reset` never shows
 * the gap because the local stack does not add Supabase's hosted bootstrap
 * default of EXECUTE granted directly to `authenticated` at function-creation
 * time — the same mechanism 20260822045809 and 20260823000000 already
 * documented for other functions. This is that same mistake, made a third
 * time, and this is the first place a green suite could have caught it.
 *
 * `create or replace` was never involved here, so this plain revoke is the
 * whole fix; it is naturally idempotent against a project that has already
 * had it applied.
 */
revoke execute on function public.event_series_detach_occurrences()
  from authenticated;
