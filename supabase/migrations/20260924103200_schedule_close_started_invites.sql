/*
 * Registered alongside sweep-promotion-offers (20260825060000), same
 * cadence and the same unschedule-first guard so re-running against a
 * project that already has the job is not an error. Runs as postgres, the
 * cron schema's owner; close_started_invites is revoked from
 * authenticated in 20260924103000. Job existence is checked with local
 * psql, not pgTAP -- see docs/testing.md, "Scheduled work".
 *
 * Accept, decline and withdraw already refuse once starts_at passes, so
 * the up-to-five minutes before this runs cannot change any outcome; it
 * only stops a dead invite holding a seat in the reads.
 */
do $$
begin
  perform cron.unschedule('close-started-invites');
exception
  when others then
    null;
end;
$$;

select cron.schedule(
  'close-started-invites',
  '*/5 * * * *',
  $$select public.close_started_invites()$$
);
