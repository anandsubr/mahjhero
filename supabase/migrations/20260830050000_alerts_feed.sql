/*
 * A real feed for the Alerts tab, reading notification_outbox for the
 * first time from the client side — see
 * docs/superpowers/specs/2026-09-02-alerts-feed-design.md for the full
 * rationale. notification_outbox itself is untouched: still no RLS
 * policy, still no grant to authenticated, exactly as
 * 20260825000000_create_bookings.sql built it. Every function below is
 * security definer, scoped to auth.uid() internally, the same shape
 * fetch_my_threads/my_unread_counts already use for "read your own X".
 */

-- One watermark per recipient, the same shape thread_reads already uses
-- for messages (20260829000000_message_threads.sql) — a single
-- last-read timestamp, not a per-notification read flag. Alerts has no
-- per-thread concept to key a row against.
create table public.notification_reads (
  recipient_id  uuid primary key references public.profiles(id) on delete cascade,
  last_read_at  timestamptz not null default now()
);

alter table public.notification_reads enable row level security;
revoke all on public.notification_reads from anon, authenticated;
grant select, insert, update on public.notification_reads to authenticated;

create policy notification_reads_own on public.notification_reads
  for all
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

-- Both functions below filter/order notification_outbox by
-- (recipient_id, created_at), and the table's own two indexes
-- (20260825000000_create_bookings.sql, 20260826010000_outbox_delivery_
-- lifecycle.sql) are both partial on `sent_at is null`/the due-queue
-- columns -- unusable here since the feed deliberately reads every
-- delivery state. my_notification_unread_count() in particular runs on
-- every tab-bar render, so an unindexed lookup here is a sequential scan
-- over an append-only, ever-growing table on every render.
create index notification_outbox_recipient_recent
  on public.notification_outbox (recipient_id, created_at desc);

/*
 * The feed's read path. Reuses outbox_render_context
 * (20260826050000_outbox_render_context.sql) — the exact function
 * claim_notification_batch itself calls to render email/push — rather
 * than re-deriving its joins by hand: that function already carries the
 * tested logic for which payload key names which actor, the
 * event_cancelled starts_at fallback for a deleted occurrence, and the
 * text-cast comparisons that keep one oddly-shaped row from poisoning a
 * whole batch. security definer privileges are what let this call
 * outbox_render_context despite that function's own
 * revoke ... from public, anon, authenticated — the same mechanism
 * claim_notification_batch already relies on.
 *
 * Shown regardless of delivery outcome (no sent_at/failed_at/expired_at
 * filter) — the feed is the reliable fallback if push or email ever
 * failed to reach someone. recipient_id/recipient_name/recipient_email/
 * channel are dropped from the returned columns: those exist in
 * outbox_render_context for email delivery specifically, and the client
 * already knows who it is.
 */
create function public.fetch_my_notifications()
returns table (
  id                uuid,
  kind              public.outbox_kind,
  payload           jsonb,
  club_id           uuid,
  club_name         text,
  event_id          uuid,
  event_title       text,
  event_starts_at   timestamptz,
  club_timezone     text,
  table_label       text,
  actor_name        text,
  broadcast_subject text,
  broadcast_body    text,
  created_at        timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select ctx.id, ctx.kind, ctx.payload, ctx.club_id, ctx.club_name,
         ctx.event_id, ctx.event_title, ctx.event_starts_at,
         ctx.club_timezone, ctx.table_label, ctx.actor_name,
         ctx.broadcast_subject, ctx.broadcast_body, ctx.created_at
    from public.outbox_render_context(
           array(
             select o.id
               from public.notification_outbox o
              where o.recipient_id = (select auth.uid())
              order by o.created_at desc
              limit 50
           )
         ) ctx
   order by ctx.created_at desc;
$$;

revoke execute on function public.fetch_my_notifications()
  from public, anon;
grant execute on function public.fetch_my_notifications()
  to authenticated;

-- The write path, an upsert on the one watermark row -- same shape as
-- mark_thread_read (20260829040000_post_message.sql).
create function public.mark_notifications_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  insert into public.notification_reads (recipient_id, last_read_at)
  values (caller, now())
  on conflict (recipient_id)
  do update set last_read_at = now();
end;
$$;

revoke execute on function public.mark_notifications_read()
  from public, anon;
grant execute on function public.mark_notifications_read()
  to authenticated;

/*
 * Feeds the TabBar badge, live rather than cached -- same reasoning
 * my_unread_counts already documents for messages: "so the badges and
 * the list cannot disagree." Counted against the full table, not capped
 * to the 50 the feed shows -- a member away long enough to have more
 * than 50 unread sees a badge larger than the visible list, which is
 * honest rather than silently wrong.
 */
create function public.my_notification_unread_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from public.notification_outbox o
    left join public.notification_reads r
           on r.recipient_id = o.recipient_id
   where o.recipient_id = (select auth.uid())
     and o.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz);
$$;

revoke execute on function public.my_notification_unread_count()
  from public, anon;
grant execute on function public.my_notification_unread_count()
  to authenticated;
