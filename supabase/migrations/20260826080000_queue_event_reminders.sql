/*
 * `clubs.reminder_offsets` has been sitting on the table since plan 2 with
 * nothing reading it. This is the reader.
 *
 * The defaults are {1440, 120} — a day ahead, which leaves time to cancel
 * and free the seat, and two hours ahead, which is the leaving-the-house
 * nudge. A club overrides them because a morning club and an evening club
 * want different timing; when the message actually lands is then the
 * member's business, through their own quiet hours.
 */
create function public.queue_event_reminders()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  queued int;
begin
  insert into public.notification_outbox
    (recipient_id, club_id, event_id, kind, payload, dedupe_key)
  select b.profile_id,
         e.club_id,
         e.id,
         'event_reminder',
         jsonb_build_object('event_id', e.id, 'offset_minutes', mins),
         'reminder:' || e.id::text || ':' || mins::text
                     || ':' || b.profile_id::text
    from public.events e
    join public.clubs c on c.id = e.club_id
    -- One row per offset per event. `mins` rather than `offset`, which is
    -- a reserved word.
    cross join lateral unnest(c.reminder_offsets) as mins
    join public.bookings b
      on b.event_id = e.id
     -- Confirmed only. A waitlisted member has no seat to be reminded of,
     -- and telling them about a game they might not get into reads as a
     -- promotion that never came.
     and b.status = 'confirmed'
   where e.status = 'published'
     and e.starts_at > now()
     and now() >= e.starts_at - make_interval(mins => mins)
  /*
   * The whole idempotency story, in one clause.
   *
   * The key is (event, offset, recipient), so the job can ask the simple
   * question — "has this threshold been crossed" — instead of the fragile
   * one — "was it crossed in the last 15 minutes". A tick that is skipped
   * because the database was restarting catches up on the next run. A tick
   * that runs twice inserts nothing the second time. No window arithmetic
   * anywhere, and nothing to get wrong when the schedule changes.
   *
   * The recipient must be in the key: a multi-row INSERT ... ON CONFLICT
   * DO NOTHING checks each row against the unique index as it is inserted,
   * including rows the same statement already placed, so a key of
   * (event, offset) alone would keep exactly one row and remind one person.
   */
  on conflict (dedupe_key) do nothing;

  get diagnostics queued = row_count;
  return queued;
end;
$$;

/*
 * A member who books after a threshold has already passed gets that
 * reminder on the next tick. That is correct — they booked knowing the
 * game is in 90 minutes — and the staleness horizon in
 * claim_notification_batch is what stops it arriving after the game began.
 * Deliberately not special-cased here.
 */

revoke execute on function public.queue_event_reminders()
  from public, anon, authenticated;

/*
 * Fifteen minutes, matching the parent spec's table. A threshold is
 * therefore crossed and queued within 15 minutes of the moment itself,
 * which is well inside the resolution anybody experiences on a 2-hour or
 * 24-hour reminder.
 *
 * `cron.unschedule` first, guarded, so re-running against a project that
 * already has the job is not an error — migrations are forward-only and
 * `db reset` replays them all. Same guard as 20260825060000.
 */
do $$
begin
  perform cron.unschedule('queue-event-reminders');
exception
  when others then
    null;
end;
$$;

select cron.schedule(
  'queue-event-reminders',
  '*/15 * * * *',
  $$select public.queue_event_reminders()$$
);
