/*
 * The function URL and the drain secret differ per environment and neither
 * belongs in a migration — migrations are committed, and this repository is
 * a public GitHub project.
 *
 * So the cron body reads both from a table that ships empty. Until somebody
 * seeds it, the job runs every minute and does nothing, which is the right
 * behaviour for a fresh `db reset`: no outbound HTTP from a developer's
 * laptop unless they asked for it.
 */
create table public.app_config (
  key   text primary key,
  value text not null
);

alter table public.app_config enable row level security;
-- No policy at all, the same posture notification_outbox takes. RLS is on
-- and nothing passes it, so a stray grant later still reaches nothing.
revoke all on public.app_config from anon, authenticated;

create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule('deliver-notifications');
exception
  when others then
    null;
end;
$$;

/*
 * Every minute. A promotion offer runs for two hours and a two-hour
 * reminder wants to land near the hour, so a minute is the coarsest
 * schedule nobody notices. The 5-minute claim lease is deliberately longer
 * than the interval: overlapping invocations are expected and skip each
 * other's leased rows rather than racing for them.
 *
 * The `where exists` makes an unconfigured environment a no-op rather than
 * an error in the cron log every sixty seconds.
 */
select cron.schedule(
  'deliver-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from public.app_config where key = 'functions_url')
           || '/deliver-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-drain-secret',
      (select value from public.app_config where key = 'drain_secret')),
    body := '{}'::jsonb
  )
  where exists (select 1 from public.app_config where key = 'functions_url')
    and exists (select 1 from public.app_config where key = 'drain_secret')
  $$
);
