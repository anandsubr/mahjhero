/*
 * The only two things in this plan that are not driven by a member's tap.
 *
 * Everything else promotes inline, inside whichever transaction freed the
 * seat. These two exist because no transaction can trigger them: an offer
 * expiring is the absence of an action, and a table that needs a fourth
 * needs telling whether or not anybody opens the app.
 *
 * `cron.unschedule` first, so re-running against a project that already
 * has the job is not an error. Migrations are forward-only and `db reset`
 * replays them all — the same guard as 20260823060000.
 *
 * Runs as `postgres`, the role `db reset` / `db push` connect as and the
 * owner of the `cron` schema, so no grant on `cron` is needed in either
 * environment. `cli_login_postgres` — the restricted role the hosted pgTAP
 * suite connects as — has no USAGE on `cron` at all, which is why job
 * existence is verified with local psql below rather than from
 * portable/grants.test.sql. See docs/testing.md, "Scheduled work".
 */
do $$
begin
  perform cron.unschedule('sweep-promotion-offers');
exception
  when others then
    null;
end;
$$;

do $$
begin
  perform cron.unschedule('announce-need-a-fourth');
exception
  when others then
    null;
end;
$$;

/*
 * Five minutes. An offer runs for two hours, so the worst case is a seat
 * held five minutes past its expiry — invisible next to the two hours, and
 * a tighter schedule buys nothing.
 */
select cron.schedule(
  'sweep-promotion-offers',
  '*/5 * * * *',
  $$select public.sweep_promotion_offers()$$
);

/*
 * Fifteen minutes, matching the parent spec's table. The stage change at
 * 12 hours is therefore announced within 15 minutes of crossing it, which
 * is well inside the resolution anybody experiences.
 */
select cron.schedule(
  'announce-need-a-fourth',
  '*/15 * * * *',
  $$select public.announce_need_a_fourth()$$
);

/*
 * Neither function takes a caller argument or checks membership — they are
 * maintenance across every event in the system, meant to be called only by
 * the schedule above (as `postgres`). 20260825010000 and 20260825050000
 * each already revoke both `from public, anon`, but neither touches
 * `authenticated`. That gap is invisible against the local stack, which
 * grants nothing to `authenticated` by default, but Supabase's hosted
 * bootstrap grants EXECUTE DIRECTLY to `authenticated` at function-creation
 * time — a grant `revoke ... from public` never clears. This is the same
 * mistake `reflow_events_for_timezone`, `assert_club_organizer` and
 * `event_series_detach_occurrences` each made and were later fixed for
 * (20260823030000, 20260823020000, 20260823060000); closing it here rather
 * than editing the already-committed migrations, for the same forward-only
 * reason 20260823060000 gave for event_series_detach_occurrences.
 */
revoke execute on function public.sweep_promotion_offers()
  from authenticated;
revoke execute on function public.announce_need_a_fourth()
  from authenticated;
