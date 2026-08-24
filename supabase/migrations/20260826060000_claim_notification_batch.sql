/*
 * The one thing the Edge Function is allowed to ask for.
 *
 * Three statements, in this order and for a reason:
 *
 *   1. Expire what is past its horizon. Before claiming, so a backlog of
 *      stale rows never occupies a batch slot. This is also what makes the
 *      first deploy safe — plan 4 has been queueing messages for weeks with
 *      nothing draining them.
 *   2. Expire what has nobody to send to. A missing address is not a
 *      transient failure and retrying it five times achieves nothing.
 *   3. Claim what is left, oldest-due first, with a lease.
 *
 * The lease exists because the send happens AFTER this transaction commits.
 * `for update ... skip locked` gives the batch exclusivity for the length
 * of the claim and not one moment longer, so the durable part of "this row
 * is being worked on" has to be the row itself: attempts up, next_attempt_at
 * pushed five minutes out. A function that dies mid-batch loses nothing and
 * a function that sends without reporting back sends twice — which is why
 * the fifth attempt is the last.
 */
create function public.claim_notification_batch(p_limit int default 50)
returns table (
  id                uuid,
  kind              public.outbox_kind,
  payload           jsonb,
  recipient_id      uuid,
  recipient_name    text,
  recipient_email   text,
  channel           text,
  club_id           uuid,
  club_name         text,
  event_id          uuid,
  event_title       text,
  event_starts_at   timestamptz,
  club_timezone     text,
  table_label       text,
  -- Whoever did the thing this message is about: booked the seat, declined
  -- it, or cancelled it. "Alice saved you a seat" is a different email from
  -- "someone saved you a seat".
  actor_name        text,
  broadcast_subject text,
  broadcast_body    text,
  created_at        timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed uuid[];
begin
  update public.notification_outbox o
     set expired_at = now()
   where o.sent_at is null and o.failed_at is null and o.expired_at is null
     and now() >= public.outbox_expires_at(
           o.kind,
           o.created_at,
           (select e.starts_at from public.events e where e.id = o.event_id));

  update public.notification_outbox o
     set expired_at = now(),
         last_error = 'recipient has no email address'
   where o.sent_at is null and o.failed_at is null and o.expired_at is null
     and not exists (
       select 1 from auth.users u
        where u.id = o.recipient_id and u.email is not null);

  with due as (
    select o.id
      from public.notification_outbox o
      join public.profiles p on p.id = o.recipient_id
     where o.sent_at is null
       and o.failed_at is null
       and o.expired_at is null
       and o.next_attempt_at <= now()
       -- The one mutable preference. Reminders for a game you booked are
       -- deliberately not mutable; the parent spec says so and this plan
       -- adds no setting that would make them so.
       and not (o.kind = 'need_a_fourth' and p.mute_need_a_fourth)
       and (
            not p.quiet_hours_enabled
         or public.outbox_quiet_class(o.kind) = 'never_held'
         or not public.in_quiet_window(p.timezone, p.quiet_hours_start,
                                       p.quiet_hours_end, now())
         /*
          * The exemption, expressed by stretching the window's far end by
          * two hours and asking whether the game starts inside it. `time +
          * interval` wraps within the day in Postgres, and in_quiet_window
          * already handles a wrapped window, so 22:00-08:00 becomes
          * 22:00-10:00 and a 09:00 game qualifies.
          *
          * A member with a window longer than 22 hours would see start and
          * end collide after stretching, and in_quiet_window reports false
          * for a zero-length window — so an exemption would be missed. That
          * is a 22-hour quiet window; the message waits until it closes.
          */
         or (public.outbox_quiet_class(o.kind) = 'exempt_near_event'
             and exists (
               select 1 from public.events e
                where e.id = o.event_id
                  and public.in_quiet_window(
                        p.timezone,
                        p.quiet_hours_start,
                        p.quiet_hours_end + interval '2 hours',
                        e.starts_at)))
       )
     -- Matches notification_outbox_due exactly, so a backlog drains in the
     -- order it accumulated and without a sort.
     order by o.next_attempt_at, o.created_at
     limit p_limit
     for update of o skip locked
  ),
  leased as (
    update public.notification_outbox o
       set attempts        = o.attempts + 1,
           next_attempt_at = now() + interval '5 minutes'
      from due
     where o.id = due.id
    returning o.id
  )
  select array_agg(leased.id) into claimed from leased;

  -- array_agg over no rows is null, not an empty array.
  if claimed is null then return; end if;

  return query select * from public.outbox_render_context(claimed);
end;
$$;

/*
 * service_role and nothing else. `revoke ... from public` alone would not
 * clear the EXECUTE that Supabase's hosted bootstrap grants `authenticated`
 * at creation time; the explicit revoke is the load-bearing one. A public
 * caller who could reach this would be able to lease every pending message
 * away from the real drain and let it expire.
 */
revoke execute on function public.claim_notification_batch(int)
  from public, anon, authenticated;
grant  execute on function public.claim_notification_batch(int)
  to service_role;
