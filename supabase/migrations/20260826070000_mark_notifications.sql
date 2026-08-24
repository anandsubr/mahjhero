/*
 * The other half of the lease: telling the queue what happened.
 *
 * Both functions ignore rows already in a terminal state. The Edge Function
 * retries a failed RPC call, and a retry that arrives after the first
 * succeeded must not un-send a message or restart a dead-lettered one.
 */

/*
 * Batched, because the happy path is a whole batch succeeding and fifty
 * round trips to say so would cost more than the sending did. Returns the
 * count actually marked, which is how a caller notices it reported the
 * same batch twice.
 */
create function public.mark_notifications_sent(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  marked int;
begin
  update public.notification_outbox
     set sent_at    = now(),
         -- A message that eventually went is not carrying a failure any
         -- more; leaving the last error would make the table read as though
         -- it had.
         last_error = null
   where id = any(p_ids)
     and sent_at is null and failed_at is null and expired_at is null;

  get diagnostics marked = row_count;
  return marked;
end;
$$;

/*
 * One at a time, because a batch fails one address at a time and each has
 * its own reason worth keeping.
 *
 * `attempts` was already incremented at claim, so a row reaching this with
 * attempts at the ceiling has had every attempt it is going to get.
 */
create function public.mark_notifications_failed(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_outbox
     -- Truncated: this is an error string from an SMTP library and there is
     -- no bound on what a server might say.
     set last_error = left(coalesce(p_error, 'unknown error'), 500),
         failed_at = case
           when attempts >= public.outbox_max_attempts() then now()
         end,
         next_attempt_at = case
           when attempts >= public.outbox_max_attempts() then next_attempt_at
           else now() + public.outbox_backoff(attempts)
         end
   where id = p_id
     and sent_at is null and failed_at is null and expired_at is null;
$$;

revoke execute on function public.mark_notifications_sent(uuid[])
  from public, anon, authenticated;
grant  execute on function public.mark_notifications_sent(uuid[])
  to service_role;

revoke execute on function public.mark_notifications_failed(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.mark_notifications_failed(uuid, text)
  to service_role;
