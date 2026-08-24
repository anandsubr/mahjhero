/*
 * The other half of a break in batch.ts's `deliverBatch`, which the last
 * round shipped without: `claim_notification_batch` increments `attempts`
 * for every row it claims, before any of them are ever attempted. Breaking
 * the drain loop early — because the failure looks like the relay, not a
 * row — only ever stopped `markFailed` from running on the rows it spared.
 * It never touched `attempts`, so a five-minute lease already burned at
 * claim time stayed burned. A 75-minute outage left every queued row with
 * `attempts` around 15 and no exponential backoff at all — the lease's
 * flat five minutes, repeated — so the moment the relay came back and
 * greylisted the very first delivery from a fresh IP, `attempts` was
 * already past `outbox_max_attempts()` and every row dead-lettered on its
 * first real retry. The budget was gone before the outage even ended.
 *
 * This function is what a break actually calls, for two different kinds of
 * row:
 *
 *   - `p_ids`: every row the batch claimed but never even tried this tick
 *     (whatever `deliverBatch` had left in `rows` after the one that broke
 *     it). Refunded outright, every time — nothing about them is evidence
 *     of anything.
 *
 *   - `p_triggering_id` / `p_triggering_error`: the one row whose own
 *     `send` produced the error the batch stopped for. Refunded too, most
 *     of the time — but tracked separately, because it is the row that
 *     leads every subsequent batch (oldest-due-first) for as long as
 *     whatever is producing that error keeps producing it. See the escape
 *     hatch below for what happens once that has gone on too long.
 */

alter table public.notification_outbox
  -- How many times IN A ROW this row, specifically, has been the one whose
  -- own send triggered a break — not a general failure count, and reset to
  -- 0 the moment this row is handled any other way (sent, or a real
  -- markFailed of its own). A row that has never triggered a break, or
  -- that broke once and then sent cleanly, is unaffected.
  add column connection_break_count int not null default 0;

/*
 * The escape hatch findings 3 and 4 both call for: without one, a row that
 * deterministically produces a connection- or 4xx-shaped error every time
 * it is tried — the exact scenario `looksLikeConnectionFailure`'s
 * `dnsadmin@club.example` example describes — gets refunded forever,
 * every tick, and being oldest-due, leads every batch behind it forever
 * too. Small on purpose: three genuine relay hiccups in a row against the
 * SAME row, coincidentally, is already a stretch; a fourth is treated as
 * "this row" rather than "the relay" being the more likely explanation.
 */
create function public.outbox_connection_break_limit()
returns int
language sql
immutable
as $$
  select 3;
$$;

create function public.release_notification_claims(
  p_ids uuid[],
  p_triggering_id uuid default null,
  p_triggering_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_break_count int;
begin
  -- Rows this tick never even attempted: refund the attempt the claim
  -- burned, and refresh the lease from now rather than leaving whatever
  -- was left of the original one -- this RPC can run any amount of time
  -- after the claim that leased them, and a nearly-expired lease would let
  -- the very next tick reclaim them before the relay (or whatever tripped
  -- the break) has had a moment to recover.
  update public.notification_outbox
     set attempts        = greatest(attempts - 1, 0),
         next_attempt_at = now() + interval '5 minutes'
   where id = any(p_ids)
     and sent_at is null and failed_at is null and expired_at is null;

  if p_triggering_id is null then
    return;
  end if;

  update public.notification_outbox
     set connection_break_count = connection_break_count + 1
   where id = p_triggering_id
     and sent_at is null and failed_at is null and expired_at is null
  returning connection_break_count into v_break_count;

  -- Already terminal (sent/failed/expired) by the time this ran, most
  -- likely an at-least-once retry of this same RPC call arriving after the
  -- first one already landed. Nothing left to release.
  if v_break_count is null then
    return;
  end if;

  if v_break_count >= public.outbox_connection_break_limit() then
    -- This row, specifically, has now looked like "the relay's fault"
    -- often enough in a row that the relay stops being the more likely
    -- explanation. Stop sparing it: treat this occurrence like any other
    -- send failure -- attempts stays at what the claim already burned,
    -- mark_notifications_failed applies the normal backoff (or dead-letters
    -- it outright if this was already its last attempt), and the streak
    -- resets so a row that later recovers gets a fresh run of free passes
    -- rather than starting pre-tripped.
    perform public.mark_notifications_failed(p_triggering_id, p_triggering_error);
    update public.notification_outbox
       set connection_break_count = 0
     where id = p_triggering_id;
  else
    update public.notification_outbox
       set attempts        = greatest(attempts - 1, 0),
           next_attempt_at = now() + interval '5 minutes'
     where id = p_triggering_id
       and sent_at is null and failed_at is null and expired_at is null;
  end if;
end;
$$;

/*
 * A normal outcome -- sent, or failed for a reason of its own -- means
 * whatever run of breaks this row was in the middle of is over. Without
 * this, a row that broke twice on a real (short-lived) relay hiccup, then
 * sent cleanly once it cleared, would carry that count into some later,
 * unrelated occasion and reach the escape hatch after only one more break
 * instead of a fresh three.
 *
 * `create or replace`, not an edit to 20260826070000: that migration
 * already shipped, and a forward-only schema evolves functions by
 * replacing them in a new migration, not by rewriting history. Same
 * signatures, same bodies otherwise -- only the new column's reset is
 * added.
 */
create or replace function public.mark_notifications_sent(p_ids uuid[])
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
         last_error = null,
         connection_break_count = 0
   where id = any(p_ids)
     and sent_at is null and failed_at is null and expired_at is null;

  get diagnostics marked = row_count;
  return marked;
end;
$$;

create or replace function public.mark_notifications_failed(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_outbox
     set last_error = left(coalesce(p_error, 'unknown error'), 500),
         connection_break_count = 0,
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

/*
 * service_role and nothing else -- the same posture as claim, sent and
 * failed above it. A public caller who could reach this could refund any
 * row's attempts at will, defeating the whole point of the attempts
 * ceiling.
 */
revoke execute on function public.outbox_connection_break_limit()
  from public, anon, authenticated;
revoke execute on function public.release_notification_claims(uuid[], uuid, text)
  from public, anon, authenticated;
grant  execute on function public.release_notification_claims(uuid[], uuid, text)
  to service_role;

revoke execute on function public.mark_notifications_sent(uuid[])
  from public, anon, authenticated;
grant  execute on function public.mark_notifications_sent(uuid[])
  to service_role;

revoke execute on function public.mark_notifications_failed(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.mark_notifications_failed(uuid, text)
  to service_role;
